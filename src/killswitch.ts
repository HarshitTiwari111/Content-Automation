import { env } from './env.js';
import { mutateResource, searchAds } from './googleads.js';
import { logger } from './logger.js';
import { readAccountMap, readRows, readSiteIds, siteKey, today, writeBack } from './sheet.js';
import type { ArticleRow } from './types.js';

/**
 * PDF section 16: "admin-only kill switch for all automated paid traffic".
 *
 * PAID_TRAFFIC_KILL_SWITCH=true hone par sirf nayi campaign banna hi nahi
 * rukta — Sheet me jitni Search/Display campaign IDs hain, unme se jo
 * Google Ads me chaalu (ENABLED) hain, sab PAUSE kar di jaati hain.
 */

interface Target {
  row: ArticleRow;
  campaignId: string;
}

/** Row ka Google Ads account — report.ts wala hi tarika. */
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

export async function pauseAllCampaigns(): Promise<void> {
  logger.info('🛑 Kill switch: Sheet ki saari chaalu campaigns PAUSE ki ja rahi hain...');

  const rows = await readRows();
  const siteIds = await readSiteIds();
  const accountMap = await readAccountMap();

  const byAccount = new Map<string, Target[]>();
  for (const row of rows) {
    const ids = [row.searchCampaignId, row.displayCampaignId].filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) continue;

    const customerId = resolveCustomerId(row, accountMap, siteIds);
    if (!customerId) {
      logger.warn(`${row.articleId}: account nahi mila, pause nahi ho saki.`);
      continue;
    }
    const list = byAccount.get(customerId) ?? [];
    for (const campaignId of ids) list.push({ row, campaignId });
    byAccount.set(customerId, list);
  }

  let paused = 0;
  let failed = 0;

  for (const [customerId, targets] of byAccount) {
    const ids = [...new Set(targets.map((t) => t.campaignId))];

    let enabled: string[];
    try {
      const response = (await searchAds(
        customerId,
        `SELECT campaign.id FROM campaign WHERE campaign.id IN (${ids.join(',')}) ` +
          `AND campaign.status = 'ENABLED'`,
      )) as { results?: Array<{ campaign?: { id?: string } }> };
      enabled = (response.results ?? []).map((r) => String(r.campaign?.id ?? '')).filter(Boolean);
    } catch (error) {
      logger.error(`Account ${customerId}: status nahi mila — ${(error as Error).message}`);
      failed += ids.length;
      continue;
    }

    if (enabled.length === 0) {
      logger.step(`Account ${customerId}: koi campaign chaalu nahi hai.`);
      continue;
    }

    if (env.dryRun) {
      logger.step(`🧪 DRY RUN — account ${customerId} me ye PAUSE hongi: ${enabled.join(', ')}`);
      continue;
    }

    try {
      await mutateResource(
        customerId,
        'campaigns',
        enabled.map((id) => ({
          update: { resourceName: `customers/${customerId}/campaigns/${id}`, status: 'PAUSED' },
          updateMask: 'status',
        })),
        'Campaign pause',
      );
    } catch (error) {
      logger.error(`Account ${customerId}: pause fail — ${(error as Error).message}`);
      failed += enabled.length;
      continue;
    }

    for (const target of targets.filter((t) => enabled.includes(t.campaignId))) {
      paused += 1;
      logger.step(`⏸️  ${target.row.articleId}: campaign ${target.campaignId} PAUSE ho gayi`);
      try {
        await writeBack(target.row.rowNumber, {
          status: 'PAUSED',
          notes: `Kill switch se PAUSE ki gayi (${today()})`,
        });
      } catch (error) {
        logger.warn(`${target.row.articleId}: Sheet me likh nahi paye — ${(error as Error).message}`);
      }
    }
  }

  logger.info(`🛑 Kill switch: ${paused} campaign PAUSE hui, ${failed} fail`);
  if (failed > 0) process.exitCode = 1;
}
