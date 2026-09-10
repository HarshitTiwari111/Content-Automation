/**
 * Phase 6 (Reporting) ka Search wala hissa.
 *
 *   npm run report
 *
 * Google Ads se har Search campaign ke clicks, spend aur CPC laake
 * CONTENT_QUEUE ki usi row me likh deta hai. Koi campaign banata ya
 * badalta nahi — sirf padhta hai.
 */
import { setDefaultResultOrder } from 'node:dns';
import { config } from '../config.js';
import { assertSheetEnv, env } from '../src/env.js';
import { searchAds } from '../src/googleads.js';
import { logger } from '../src/logger.js';
import {
  hasColumn,
  readAccountMap,
  readRows,
  readSiteIds,
  siteKey,
  today,
  upsertReportRow,
  writeBack,
} from '../src/sheet.js';
import type { ArticleRow } from '../src/types.js';

setDefaultResultOrder('ipv4first');

interface AdsRow {
  campaign?: { id?: string; status?: string };
  metrics?: {
    clicks?: string | number;
    impressions?: string | number;
    costMicros?: string | number;
    averageCpc?: string | number;
  };
}

function toUnits(micros: string | number | undefined): number {
  const n = Number(micros ?? 0);
  return Number.isFinite(n) ? Math.round((n / 1_000_000) * 100) / 100 : 0;
}

/** Row ka Google Ads account — wahi logic jo campaign banate waqt lagta hai. */
function resolveCustomerId(
  row: ArticleRow,
  accountMap: Map<string, string>,
  siteIds: Map<string, string>,
): string {
  const resolvedSiteId =
    (row.website ? siteIds.get(siteKey(row.website)) : undefined) ??
    (row.liveUrl ? siteIds.get(siteKey(row.liveUrl)) : undefined);

  return (
    (resolvedSiteId ? accountMap.get(siteKey(resolvedSiteId)) : undefined) ??
    (row.siteId ? accountMap.get(siteKey(row.siteId)) : undefined) ??
    (row.website ? accountMap.get(siteKey(row.website)) : undefined) ??
    env.ads.customerId
  );
}

async function main(): Promise<void> {
  logger.blank();
  logger.info('═══════════════════════════════════════════════');
  logger.info('  Phase 6 — Search campaigns ka data Sheet me');
  logger.info(`  Date range: ${config.report.dateRange}`);
  logger.info('═══════════════════════════════════════════════');

  assertSheetEnv();

  const rows = await readRows();
  const siteIds = await readSiteIds();
  const accountMap = await readAccountMap();

  const withCampaign = rows.filter((row) => row.searchCampaignId !== '');
  logger.info(`📄 ${withCampaign.length} rows me Search Campaign ID mila`);

  if (withCampaign.length === 0) {
    logger.info('Kuch karne ko nahi hai.');
    return;
  }

  // Account ke hisaab se baant lo — har account ki apni query jaati hai.
  const byAccount = new Map<string, ArticleRow[]>();
  for (const row of withCampaign) {
    const customerId = resolveCustomerId(row, accountMap, siteIds);
    if (!customerId) {
      logger.warn(`${row.articleId}: account nahi mila, chhod diya.`);
      continue;
    }
    byAccount.set(customerId, [...(byAccount.get(customerId) ?? []), row]);
  }

  let updated = 0;
  let failed = 0;

  for (const [customerId, accountRows] of byAccount) {
    logger.blank();
    logger.info(`🏢 Account ${customerId} — ${accountRows.length} campaigns`);

    const ids = accountRows.map((row) => row.searchCampaignId).filter(Boolean);

    for (let i = 0; i < ids.length; i += config.report.batchSize) {
      const batch = ids.slice(i, i + config.report.batchSize);
      const query =
        'SELECT campaign.id, campaign.status, metrics.clicks, metrics.impressions, metrics.cost_micros, ' +
        `metrics.average_cpc FROM campaign WHERE campaign.id IN (${batch.join(',')}) ` +
        `AND segments.date DURING ${config.report.dateRange}`;

      let results: AdsRow[];
      try {
        const response = (await searchAds(customerId, query)) as { results?: AdsRow[] };
        results = response.results ?? [];
      } catch (error) {
        logger.error(`Data nahi mila: ${error instanceof Error ? error.message : String(error)}`);
        failed += batch.length;
        continue;
      }

      const byId = new Map<string, AdsRow>();
      for (const result of results) {
        if (result.campaign?.id) byId.set(String(result.campaign.id), result);
      }

      for (const row of accountRows) {
        const data = byId.get(row.searchCampaignId);
        if (!data) continue; // Is date range me is campaign ka koi data nahi.

        const clicks = Number(data.metrics?.clicks ?? 0);
        const impressions = Number(data.metrics?.impressions ?? 0);
        const spend = toUnits(data.metrics?.costMicros);
        const cpc = toUnits(data.metrics?.averageCpc);
        const adsStatus = (data.campaign?.status ?? '').toUpperCase();

        try {
          // Asli reporting REPORTING tab me jaati hai (PDF section 13).
          await upsertReportRow({
            date: today(),
            articleId: row.articleId,
            liveUrl: row.liveUrl,
            trafficSource: config.report.trafficSource,
            impressions,
            clicks,
            spend,
            cpc,
          });

          // CONTENT_QUEUE me ye columns hon to wahan bhi bhar dete hain.
          await writeBack(row.rowNumber, {
            ...(hasColumn('clicks') ? { clicks: String(clicks) } : {}),
            ...(hasColumn('spend') ? { spend: String(spend) } : {}),
            ...(hasColumn('cpc') ? { cpc: String(cpc) } : {}),
            // Google me campaign chaalu ho gayi to Sheet me LIVE dikhao
            // (PDF section 14 ka state). Warna status waisa hi rehne do.
            ...(adsStatus === 'ENABLED' ? { status: 'LIVE' } : {}),
          });
          logger.step(
            `${row.articleId}: ${impressions} impr, ${clicks} clicks, ${spend} spend, ${cpc} CPC` +
              (adsStatus === 'ENABLED' ? '  → LIVE' : ''),
          );
          updated += 1;
        } catch (error) {
          logger.error(
            `${row.articleId}: Sheet me likhne me problem — ` +
              (error instanceof Error ? error.message : String(error)),
          );
          failed += 1;
        }
      }
    }
  }

  logger.blank();
  logger.info('───────────────── SUMMARY ─────────────────');
  logger.info(`✅ ${updated} rows update hui`);
  logger.info(`❌ ${failed} fail`);
  logger.blank();
}

void main().catch((error: unknown) => {
  logger.blank();
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
