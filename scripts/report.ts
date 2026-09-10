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
  segments?: { date?: string };
  metrics?: {
    clicks?: string | number;
    impressions?: string | number;
    costMicros?: string | number;
    averageCpc?: string | number;
  };
}

/** Google "2026-09-10" deta hai; Sheet me "10/09/2026" chahiye. */
function toSheetDate(googleDate: string | undefined): string {
  const parts = (googleDate ?? '').split('-');
  if (parts.length !== 3) return today();
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
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
        'SELECT campaign.id, campaign.status, segments.date, metrics.clicks, ' +
        'metrics.impressions, metrics.cost_micros, ' +
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

      // Ek campaign ke kai din — har din ki apni row aati hai.
      const byCampaign = new Map<string, AdsRow[]>();
      for (const result of results) {
        const id = result.campaign?.id ? String(result.campaign.id) : '';
        if (!id) continue;
        byCampaign.set(id, [...(byCampaign.get(id) ?? []), result]);
      }

      for (const row of accountRows) {
        const days = byCampaign.get(row.searchCampaignId) ?? [];
        if (days.length === 0) {
          // PAUSED campaign kabhi chali hi nahi, to Google koi din wapas nahi karta.
          logger.step(`${row.articleId}: is range me koi data nahi (campaign chali hi nahi)`);
          continue;
        }

        let totalClicks = 0;
        let totalSpend = 0;
        let adsStatus = '';

        try {
          // PDF section 13: "Daily/weekly clicks, spend, CPC" — har din ki alag row.
          for (const day of days) {
            const clicks = Number(day.metrics?.clicks ?? 0);
            const impressions = Number(day.metrics?.impressions ?? 0);
            const spend = toUnits(day.metrics?.costMicros);
            const cpc = toUnits(day.metrics?.averageCpc);

            totalClicks += clicks;
            totalSpend += spend;
            adsStatus = (day.campaign?.status ?? adsStatus).toUpperCase();

            await upsertReportRow({
              date: toSheetDate(day.segments?.date),
              articleId: row.articleId,
              liveUrl: row.liveUrl,
              trafficSource: config.report.trafficSource,
              impressions,
              clicks,
              spend,
              cpc,
            });
            updated += 1;
          }

          // CONTENT_QUEUE me poore range ka jod — wahan ek hi row hai.
          const totalCpc = totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0;
          await writeBack(row.rowNumber, {
            ...(hasColumn('clicks') ? { clicks: String(totalClicks) } : {}),
            ...(hasColumn('spend') ? { spend: String(Math.round(totalSpend * 100) / 100) } : {}),
            ...(hasColumn('cpc') ? { cpc: String(totalCpc) } : {}),
            // Google me campaign chaalu ho gayi to Sheet me LIVE dikhao
            // (PDF section 14 ka state). Warna status waisa hi rehne do.
            ...(adsStatus === 'ENABLED' ? { status: 'LIVE' } : {}),
          });

          logger.step(
            `${row.articleId}: ${days.length} din, kul ${totalClicks} clicks, ${totalSpend} spend` +
              (adsStatus === 'ENABLED' ? '  → LIVE' : ''),
          );
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
