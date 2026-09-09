import { setDefaultResultOrder } from 'node:dns';
import { config } from '../config.js';
import { assertSheetEnv, cli, env } from './env.js';
import { createSearchCampaign, describeAdsError, PartialCampaignError } from './googleads.js';
import { logger } from './logger.js';
import { buildPlan } from './plan.js';
import {
  appendCampaignRecord,
  assertAccountMapWritable,
  readAccountMap,
  readSiteIds,
  readCampaignTemplates,
  readCreatedCampaigns,
  readRows,
  selectEligible,
  siteKey,
} from './sheet.js';
import type { ArticleRow, CampaignPlan, CampaignTemplate, RowOutcome } from './types.js';

/**
 * Kuch ISP connections pe IPv6 lad-khadata hai aur "getaddrinfo ENOTFOUND"
 * aata hai. IPv4 ko pehle try karne se ye problem hat jaati hai.
 */
setDefaultResultOrder('ipv4first');

function printPlanPreview(plan: CampaignPlan): void {
  logger.step(`🔑 ${plan.keywords.length} keyword criteria`);
  logger.step(`   ${plan.keywords.slice(0, 5).map((k) => `${k.text} [${k.matchType}]`).join(', ')}${plan.keywords.length > 5 ? ' …' : ''}`);
  logger.step(`✍️  ${plan.adCopy.headlines.length} headlines, ${plan.adCopy.descriptions.length} descriptions`);
  logger.step(`   H1: "${plan.adCopy.headlines[0] ?? ''}"`);
  logger.step(`   D1: "${plan.adCopy.descriptions[0] ?? ''}"`);
  logger.step(`🏷️  ${plan.campaignName}`);
  logger.step(`🔗 ${plan.finalUrl}?${plan.finalUrlSuffix}`);
}

/**
 * Row ki campaign kis Google Ads account me banegi.
 * Pehle AD_ACCOUNT_MAP tab dekhte hain (Site ID / Website se), na mile to
 * .env wali GOOGLE_ADS_CUSTOMER_ID fallback hai.
 */
function resolveCustomerId(
  row: ArticleRow,
  accountMap: Map<string, string>,
  resolvedSiteId?: string,
): string {
  const fromResolved = resolvedSiteId ? accountMap.get(siteKey(resolvedSiteId)) : undefined;
  const fromSiteId = row.siteId ? accountMap.get(siteKey(row.siteId)) : undefined;
  const fromWebsite = row.website ? accountMap.get(siteKey(row.website)) : undefined;
  return fromResolved ?? fromSiteId ?? fromWebsite ?? env.ads.customerId;
}

/** Row ke domain se WEBSITE_CONFIG wala Site ID (SITE-4 jaisa) nikalta hai. */
function resolveSiteId(row: ArticleRow, siteIds: Map<string, string>): string | undefined {
  return (
    (row.website ? siteIds.get(siteKey(row.website)) : undefined) ??
    (row.liveUrl ? siteIds.get(siteKey(row.liveUrl)) : undefined)
  );
}

/**
 * Row ke Template naam se CAMPAIGN_TEMPLATES wali row dhoondhta hai.
 * Naam likha ho par template na mile to chetavni deta hai — chup-chaap
 * config ke defaults pe chale jaana galat hoga.
 */
function findTemplate(
  row: ArticleRow,
  templates: Map<string, CampaignTemplate>,
): CampaignTemplate | undefined {
  // Row me Template likha ho to wahi, warna config wala default template.
  const wanted = row.template || config.defaultTemplate;
  if (!wanted) return undefined;

  const key = wanted.trim().toLowerCase().replace(/\s+/g, ' ');
  const found = templates.get(key);

  if (!found) {
    // Row me naam likha tha par mila nahi — ye batana zaroori hai.
    // Default template na mile to chup rehna theek hai (shayad tab hi khaali hai).
    if (row.template) {
      logger.warn(
        `Template "${row.template}" ${config.campaignTemplates.tab} me nahi mila — ` +
          'config ke defaults use ho rahe hain.',
      );
    }
    return undefined;
  }

  // Default Status kuch bhi ho, campaign PAUSED hi banegi — ye niyam badal
  // nahi sakta. Lekin agar template kuch aur kehta hai to bata dena chahiye.
  const status = found.defaultStatus.trim().toUpperCase();
  if (status && status !== 'PAUSED') {
    logger.warn(
      `Template "${found.name}" ka Default Status "${found.defaultStatus}" hai, ` +
        'lekin campaign phir bhi PAUSED hi banegi (ye rule code me fix hai).',
    );
  }
  if (found.device) {
    logger.warn(
      `Template "${found.name}" me Device "${found.device}" likha hai — ` +
        'device targeting abhi apply nahi hoti.',
    );
  }

  return found;
}

async function processRow(
  row: ArticleRow,
  accountMap: Map<string, string>,
  siteIds: Map<string, string>,
  templates: Map<string, CampaignTemplate>,
): Promise<RowOutcome> {
  logger.blank();
  logger.info(`▶ ${row.articleId} — "${row.title || row.topic}" (row ${row.rowNumber})`);

  // try ke bahar, taaki error hone par bhi record me likh sakein.
  const resolvedSiteId = resolveSiteId(row, siteIds);
  const template = findTemplate(row, templates);

  try {
    let customerId = resolveCustomerId(row, accountMap, resolvedSiteId);
    if (!customerId) {
      const message =
        `Google Ads account nahi mila. ${config.accountMap.tab} tab me ` +
        `"${row.siteId || row.website}" ke saamne Google Ads CID daalo ` +
        '(ya .env me GOOGLE_ADS_CUSTOMER_ID bharo).';

      // Dry run me kuch bheja hi nahi jaata, isliye account ke bina bhi
      // keywords/ad copy ka preview dikha dete hain.
      if (!env.dryRun) throw new Error(message);
      logger.warn(message);
      customerId = 'DRY-RUN-NO-ACCOUNT';
    }

    const plan = await buildPlan(row, customerId, resolvedSiteId, template);
    logger.step(`🏢 Site: ${resolvedSiteId ?? "(WEBSITE_CONFIG me nahi mila)"}  |  Account: ${customerId}  |  Template: ${template?.name ?? "(koi nahi)"}`);
    logger.step(`✅ URL check OK, budget ${plan.dailyBudget}/day, GEO ${plan.geo}`);
    printPlanPreview(plan);

    const result = await createSearchCampaign(plan);

    if (!env.dryRun) {
      await appendCampaignRecord({
        siteId: resolvedSiteId ?? row.siteId ?? row.website,
        customerId,
        articleId: row.articleId,
        searchCampaignId: result.campaignId,
        status: 'CAMPAIGN_CREATED',
        notes: '',
      });
      logger.step(`📄 ${config.accountMap.tab} me campaign ID likh diya`);
    }

    return { articleId: row.articleId, ok: true, campaignId: result.campaignId };
  } catch (error) {
    const reason = describeAdsError(error);
    logger.error(reason);

    // Campaign ban chuki thi lekin aage fail hua — ID zaroor likho,
    // warna agli run wahi campaign dobara bana degi.
    const partialId = error instanceof PartialCampaignError ? error.campaignId : undefined;
    if (partialId) {
      logger.warn(`Campaign ${partialId} ban chuki hai (adhoori). Sheet me ID likh raha hoon.`);
    }

    if (!env.dryRun) {
      try {
        await appendCampaignRecord({
          siteId: resolvedSiteId ?? row.siteId ?? row.website,
          customerId: resolveCustomerId(row, accountMap, resolvedSiteId),
          articleId: row.articleId,
          searchCampaignId: partialId ?? '',
          status: 'ERROR',
          notes: reason.slice(0, 500),
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
  logger.info('  Phase 5 — Google Search Campaign Automation');
  logger.info(`  Mode: ${env.dryRun ? '🧪 DRY RUN (kuch create nahi hoga)' : '🚀 LIVE (PAUSED campaigns banengi)'}`);
  logger.info('═══════════════════════════════════════════════');

  assertSheetEnv();

  const allRows = await readRows();
  logger.info(`📄 ${env.sheetTab} padhi — ${allRows.length} rows`);

  const templates = await readCampaignTemplates();
  logger.info(`📋 ${config.campaignTemplates.tab} — ${templates.size} template mile`);

  const siteIds = await readSiteIds();
  logger.info(`🌐 ${config.websiteConfig.tab} — ${siteIds.size} site codes mile`);

  const accountMap = await readAccountMap();
  logger.info(
    accountMap.size > 0
      ? `🏢 ${config.accountMap.tab} — ${accountMap.size} site→account mapping mili`
      : `🏢 ${config.accountMap.tab} khaali hai — .env wali GOOGLE_ADS_CUSTOMER_ID use hogi`,
  );

  // Live me campaign banane se pehle pakka karo ki uska record likha ja sakega.
  if (!env.dryRun) {
    await assertAccountMapWritable();
    logger.info(`✅ ${config.accountMap.tab} likhne ke liye taiyar hai`);
  }

  const createdCampaigns = await readCreatedCampaigns();
  if (createdCampaigns.size > 0) {
    logger.info(`✅ ${createdCampaigns.size} articles ki campaign pehle se bani hui hai — skip hongi`);
  }

  let eligible = selectEligible(allRows, createdCampaigns);
  if (cli.article) {
    eligible = eligible.filter((row) => row.articleId === cli.article);
    logger.info(`🎯 Filter: sirf article ${cli.article}`);
  }

  const cap = Math.min(cli.limit ?? config.maxRowsPerRun, config.maxRowsPerRun);
  if (eligible.length > cap) {
    logger.info(`⚠️  ${eligible.length} rows mili, is run me sirf ${cap} process hongi.`);
    eligible = eligible.slice(0, cap);
  }

  logger.info(`✅ ${eligible.length} rows ready (Search=YES, campaign ID khaali, URL bhara hua)`);

  if (eligible.length === 0) {
    logger.blank();
    logger.info('Kuch karne ko nahi hai. Sheet me Search column me YES likho aur dobara chalao.');
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
  logger.info(`✅ ${ok.length} campaigns ${env.dryRun ? 'ban sakti thi (dry run)' : 'ban gayi (PAUSED)'}`);
  logger.info(`❌ ${failed.length} fail`);
  for (const failure of failed) {
    logger.info(`   • ${failure.articleId}: ${failure.reason}`);
  }
  if (env.dryRun) {
    logger.blank();
    logger.info('Dry run tha — Sheet me kuch nahi likha gaya, Google Ads me kuch nahi bana.');
    logger.info('Sab theek lage to live chalao:  npm run create -- --live');
  }
  logger.info(`📝 Log file: ${logger.logFile}`);
  logger.blank();
}

main().catch((error: unknown) => {
  logger.blank();
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
