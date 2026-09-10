import { setDefaultResultOrder } from 'node:dns';
import { config } from '../config.js';
import { createDisplayCampaign } from './displayads.js';
import { buildDisplayPlan } from './displayplan.js';
import { assertSheetEnv, cli, env } from './env.js';
import { describeAdsError, PartialCampaignError } from './googleads.js';
import { logger } from './logger.js';
import {
  appendErrorLog,
  hasColumn,
  readAccountMap,
  readCampaignTemplates,
  readRows,
  readSiteIds,
  siteKey,
  writeBack,
} from './sheet.js';
import type { ArticleRow, CampaignTemplate, RowOutcome } from './types.js';

/**
 * Phase 4 — Google Display (PDF section 9).
 *
 * CONTENT_QUEUE me jis row par Display (Y/N) = YES hai, us article ke liye
 * Responsive Display Ad ke saath PAUSED Display campaign banata hai.
 */

setDefaultResultOrder('ipv4first');

function resolveSiteId(row: ArticleRow, siteIds: Map<string, string>): string | undefined {
  return (
    (row.website ? siteIds.get(siteKey(row.website)) : undefined) ??
    (row.liveUrl ? siteIds.get(siteKey(row.liveUrl)) : undefined)
  );
}

function resolveCustomerId(
  row: ArticleRow,
  accountMap: Map<string, string>,
  resolvedSiteId?: string,
): string {
  const mapped =
    (resolvedSiteId ? accountMap.get(siteKey(resolvedSiteId)) : undefined) ??
    (row.siteId ? accountMap.get(siteKey(row.siteId)) : undefined) ??
    (row.website ? accountMap.get(siteKey(row.website)) : undefined);
  if (mapped) return mapped;

  return accountMap.size === 0 ? env.ads.customerId : '';
}

function findTemplate(
  row: ArticleRow,
  templates: Map<string, CampaignTemplate>,
): CampaignTemplate | undefined {
  const wanted = row.template || config.defaultTemplate;
  if (!wanted) return undefined;
  return templates.get(wanted.trim().toLowerCase().replace(/\s+/g, ' '));
}

/** Display = YES, campaign ID khaali, URL aur image maujood. */
function selectEligible(rows: ArticleRow[]): ArticleRow[] {
  return rows.filter((row) => {
    const wants = ['yes', 'y', 'true'].includes(row.display.toLowerCase());
    return wants && row.displayCampaignId === '' && row.liveUrl !== '';
  });
}

async function processRow(
  row: ArticleRow,
  accountMap: Map<string, string>,
  siteIds: Map<string, string>,
  templates: Map<string, CampaignTemplate>,
): Promise<RowOutcome> {
  logger.blank();
  logger.info(`▶ ${row.articleId} — "${row.title || row.topic}" (row ${row.rowNumber})`);

  const resolvedSiteId = resolveSiteId(row, siteIds);

  try {
    const customerId = resolveCustomerId(row, accountMap, resolvedSiteId);
    if (!customerId) {
      throw new Error(
        `"${resolvedSiteId ?? row.website}" ka Google Ads account nahi mila. ` +
          `${config.accountMap.tab} tab me is site ki row bana ke CID daalo.`,
      );
    }

    const template = findTemplate(row, templates);
    const plan = await buildDisplayPlan(row, customerId, resolvedSiteId, template);

    logger.step(`🏢 Site: ${resolvedSiteId ?? '(nahi mila)'}  |  Account: ${customerId}`);
    logger.step(`✅ URL check OK, budget ${plan.dailyBudget}/day, GEO ${plan.geo}`);
    logger.step(
      `✍️  ${plan.adCopy.headlines.length} headlines, ${plan.adCopy.descriptions.length} descriptions`,
    );
    logger.step(`   Long headline: "${plan.adCopy.longHeadline}"`);
    logger.step(`   Business name: "${plan.adCopy.businessName}"`);
    logger.step(`🏷️  ${plan.campaignName}`);
    logger.step(`🔗 ${plan.finalUrl}?${plan.finalUrlSuffix}`);

    const result = await createDisplayCampaign(plan);

    if (!env.dryRun) {
      await writeBack(row.rowNumber, {
        displayCampaignId: result.campaignId,
        status: 'CAMPAIGN_CREATED',
        notes: '',
      });
      logger.step(`📄 ${env.sheetTab} row ${row.rowNumber} me campaign ID likh diya`);
    }

    return { articleId: row.articleId, ok: true, campaignId: result.campaignId };
  } catch (error) {
    const reason = describeAdsError(error);
    logger.error(reason);

    const partialId = error instanceof PartialCampaignError ? error.campaignId : undefined;
    if (partialId) {
      logger.warn(`Campaign ${partialId} ban chuki hai (adhoori). Sheet me ID likh raha hoon.`);
    }

    if (!env.dryRun) {
      try {
        await writeBack(row.rowNumber, {
          ...(partialId ? { displayCampaignId: partialId } : {}),
          status: 'ERROR',
          notes: reason.slice(0, 500),
        });
        await appendErrorLog({
          articleId: row.articleId,
          message: reason.slice(0, 500),
          retryStatus: partialId ? 'PARTIAL — campaign bani, aage fail' : 'PENDING',
        });
      } catch (writeError) {
        logger.error(`Sheet me error likhne me bhi problem: ${(writeError as Error).message}`);
      }
    }

    return { articleId: row.articleId, ok: false, reason };
  }
}

async function main(): Promise<void> {
  logger.blank();
  logger.info('═══════════════════════════════════════════════');
  logger.info('  Phase 4 — Google Display Campaign Automation');
  logger.info(
    `  Mode: ${env.dryRun ? '🧪 DRY RUN (kuch create nahi hoga)' : '🚀 LIVE (PAUSED campaigns banengi)'}`,
  );
  logger.info('═══════════════════════════════════════════════');

  assertSheetEnv();

  const allRows = await readRows();
  logger.info(`📄 ${env.sheetTab} padhi — ${allRows.length} rows`);

  if (!hasColumn('display') || !hasColumn('displayCampaignId')) {
    throw new Error(
      `${env.sheetTab} ki row 1 me "Display (Y/N)" aur "Display Campaign ID" columns add karo.`,
    );
  }
  if (!hasColumn('featuredImage')) {
    throw new Error(
      `${env.sheetTab} ki row 1 me "Featured Image" column add karo — ` +
        'Display ad bina image ke nahi banta.',
    );
  }

  const templates = await readCampaignTemplates();
  const siteIds = await readSiteIds();
  const accountMap = await readAccountMap();
  logger.info(`🌐 ${siteIds.size} site codes, ${accountMap.size} account mapping, ${templates.size} template`);

  let eligible = selectEligible(allRows);
  if (cli.article) {
    eligible = eligible.filter((row) => row.articleId === cli.article);
  }

  const cap = Math.min(cli.limit ?? config.maxRowsPerRun, config.maxRowsPerRun);
  if (eligible.length > cap) eligible = eligible.slice(0, cap);

  logger.info(`✅ ${eligible.length} rows ready (Display=YES, campaign ID khaali, URL bhara hua)`);

  if (eligible.length === 0) {
    logger.blank();
    logger.info('Kuch karne ko nahi hai. Sheet me Display column me YES likho.');
    return;
  }

  const outcomes: RowOutcome[] = [];
  for (const row of eligible) {
    outcomes.push(await processRow(row, accountMap, siteIds, templates));
  }

  const ok = outcomes.filter((o) => o.ok);
  const failed = outcomes.filter((o) => !o.ok);

  logger.blank();
  logger.info('───────────────── SUMMARY ─────────────────');
  logger.info(
    `✅ ${ok.length} campaigns ${env.dryRun ? 'ban sakti thi (dry run)' : 'ban gayi (PAUSED)'}`,
  );
  logger.info(`❌ ${failed.length} fail`);
  for (const failure of failed) logger.info(`   • ${failure.articleId}: ${failure.reason}`);
  logger.info(`📝 Log file: ${logger.logFile}`);
  logger.blank();
}

main().catch((error: unknown) => {
  logger.blank();
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
