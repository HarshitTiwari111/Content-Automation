/**
 * Phase 6 (Reporting) — Search aur Display dono.
 *
 *   npm run report
 *
 * Google Ads se har campaign ke clicks, spend, CPC aur status laake
 * REPORTING tab me din-wise likhta hai, aur CONTENT_QUEUE me jod.
 * Koi campaign banata ya badalta nahi — sirf padhta hai.
 */
import { setDefaultResultOrder } from 'node:dns';
import { config } from '../config.js';
import { assertSheetEnv, env } from '../src/env.js';
import { assertAdsAccess, searchAds } from '../src/googleads.js';
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

/** Ek article ki ek channel wali campaign. */
interface Target {
  row: ArticleRow;
  campaignId: string;
  source: string;
}

/** CONTENT_QUEUE ki ek row ka jod (Search + Display milake). */
interface RowTotal {
  row: ArticleRow;
  clicks: number;
  spend: number;
  hasData: boolean;
  live: boolean;
}

/** PDF ke channels — har ek ka apna ID column aur Traffic Source naam. */
const CHANNELS = [
  { field: 'searchCampaignId', source: config.report.trafficSource },
  { field: 'displayCampaignId', source: config.report.displayTrafficSource },
] as const;

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

/** Google ka status → Sheet ka state (PDF section 14: ENABLED = LIVE). */
function toState(status: string): string {
  return status === 'ENABLED' ? 'LIVE' : status;
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
  logger.info('  Phase 6 — Search + Display campaigns ka data Sheet me');
  logger.info(`  Date range: ${config.report.dateRange}`);
  logger.info('═══════════════════════════════════════════════');

  assertSheetEnv();

  const rows = await readRows();
  const siteIds = await readSiteIds();
  const accountMap = await readAccountMap();

  const targets: Target[] = [];
  for (const row of rows) {
    for (const channel of CHANNELS) {
      const campaignId = row[channel.field];
      if (/^\d+$/.test(campaignId)) targets.push({ row, campaignId, source: channel.source });
    }
  }
  logger.info(`📄 ${targets.length} campaign IDs mile (Search + Display)`);

  if (targets.length === 0) {
    logger.info('Kuch karne ko nahi hai.');
    return;
  }

  // Account ke hisaab se baant lo — har account ki apni query jaati hai.
  const byAccount = new Map<string, Target[]>();
  for (const target of targets) {
    const customerId = resolveCustomerId(target.row, accountMap, siteIds);
    if (!customerId) {
      logger.warn(`${target.row.articleId}: account nahi mila, chhod diya.`);
      continue;
    }
    byAccount.set(customerId, [...(byAccount.get(customerId) ?? []), target]);
  }

  await assertAdsAccess([...byAccount.keys()]);

  const totals = new Map<number, RowTotal>();
  let updated = 0;
  let failed = 0;

  for (const [customerId, accountTargets] of byAccount) {
    logger.blank();
    logger.info(`🏢 Account ${customerId} — ${accountTargets.length} campaigns`);

    for (let i = 0; i < accountTargets.length; i += config.report.batchSize) {
      const batch = accountTargets.slice(i, i + config.report.batchSize);
      const ids = [...new Set(batch.map((t) => t.campaignId))].join(',');

      // Status alag se — 0 clicks wali campaign ka bhi state pata chale.
      const statuses = new Map<string, string>();
      try {
        const response = (await searchAds(
          customerId,
          `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id IN (${ids})`,
        )) as { results?: AdsRow[] };
        for (const result of response.results ?? []) {
          const id = result.campaign?.id ? String(result.campaign.id) : '';
          const status = String(result.campaign?.status ?? '').toUpperCase();
          if (id && status) statuses.set(id, status);
        }
      } catch (error) {
        logger.warn(`Status nahi mila: ${error instanceof Error ? error.message : String(error)}`);
      }

      let results: AdsRow[];
      try {
        const response = (await searchAds(
          customerId,
          'SELECT campaign.id, campaign.status, segments.date, metrics.clicks, ' +
            'metrics.impressions, metrics.cost_micros, metrics.average_cpc ' +
            `FROM campaign WHERE campaign.id IN (${ids}) ` +
            `AND segments.date DURING ${config.report.dateRange}`,
        )) as { results?: AdsRow[] };
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
        if (id) byCampaign.set(id, [...(byCampaign.get(id) ?? []), result]);
      }

      for (const target of batch) {
        const { row, campaignId, source } = target;
        const status = statuses.get(campaignId) ?? '';
        const days = byCampaign.get(campaignId) ?? [];

        const total = totals.get(row.rowNumber) ?? {
          row,
          clicks: 0,
          spend: 0,
          hasData: false,
          live: false,
        };
        if (status === 'ENABLED') total.live = true;
        totals.set(row.rowNumber, total);

        if (days.length === 0) {
          logger.step(
            `${row.articleId} (${source}): is range me koi data nahi` +
              (status ? ` — state ${toState(status)}` : ''),
          );
          continue;
        }

        let clicksSum = 0;
        let spendSum = 0;
        try {
          // PDF section 13: "Daily/weekly clicks, spend, CPC and campaign state".
          for (const day of days) {
            const clicks = Number(day.metrics?.clicks ?? 0);
            const spend = toUnits(day.metrics?.costMicros);
            clicksSum += clicks;
            spendSum += spend;

            await upsertReportRow({
              date: toSheetDate(day.segments?.date),
              articleId: row.articleId,
              liveUrl: row.liveUrl,
              trafficSource: source,
              impressions: Number(day.metrics?.impressions ?? 0),
              clicks,
              spend,
              cpc: toUnits(day.metrics?.averageCpc),
              campaignState: toState(status || String(day.campaign?.status ?? '').toUpperCase()),
            });
            updated += 1;
          }

          total.clicks += clicksSum;
          total.spend += spendSum;
          total.hasData = true;
          logger.step(
            `${row.articleId} (${source}): ${days.length} din, ${clicksSum} clicks, ` +
              `${Math.round(spendSum * 100) / 100} spend — state ${toState(status) || '?'}`,
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

  // CONTENT_QUEUE me poore range ka jod — wahan har article ki ek hi row hai.
  for (const total of totals.values()) {
    const spend = Math.round(total.spend * 100) / 100;
    const cpc = total.clicks > 0 ? Math.round((total.spend / total.clicks) * 100) / 100 : 0;
    const updates: Record<string, string> = {
      ...(total.hasData && hasColumn('clicks') ? { clicks: String(total.clicks) } : {}),
      ...(total.hasData && hasColumn('spend') ? { spend: String(spend) } : {}),
      ...(total.hasData && hasColumn('cpc') ? { cpc: String(cpc) } : {}),
      // Google me koi bhi channel chaalu ho to Sheet me LIVE (PDF section 14).
      ...(total.live ? { status: 'LIVE' } : {}),
    };
    if (Object.keys(updates).length === 0) continue;

    try {
      await writeBack(total.row.rowNumber, updates);
    } catch (error) {
      logger.error(
        `${total.row.articleId}: ${env.sheetTab} me likhne me problem — ` +
          (error instanceof Error ? error.message : String(error)),
      );
      failed += 1;
    }
  }

  logger.blank();
  logger.info('───────────────── SUMMARY ─────────────────');
  logger.info(`✅ ${updated} REPORTING rows update hui`);
  logger.info(`❌ ${failed} fail`);
  logger.blank();
}

void main().catch((error: unknown) => {
  logger.blank();
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
