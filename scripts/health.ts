/**
 * Health check — har site ke Google Ads account ki jaanch.
 *
 *   npm run health
 *
 * Budget khatam, ad disapproved, campaign band — jo bhi mile wo
 * WEBSITE_CONFIG ke "Issue" column me likh deta hai, aur article wali
 * dikkat CONTENT_QUEUE ke Error / Notes aur ERROR_LOG me.
 *
 * Ye sirf padhta hai — koi campaign banata ya badalta nahi.
 */
import { setDefaultResultOrder } from 'node:dns';
import { config } from '../config.js';
import { assertSheetEnv, env } from '../src/env.js';
import { checkAccountHealth } from '../src/health.js';
import { logger } from '../src/logger.js';
import {
  appendErrorLog,
  hasColumn,
  readAccountMap,
  readRows,
  readWebsiteConfigRows,
  siteKey,
  writeBackMany,
  writeWebsiteIssues,
} from '../src/sheet.js';

setDefaultResultOrder('ipv4first');

async function main(): Promise<void> {
  logger.blank();
  logger.info('═══════════════════════════════════════════════');
  logger.info('  Health check — har site ke account ki jaanch');
  logger.info(`  Pichhle ${config.health.lookbackDays} din ka data`);
  logger.info('═══════════════════════════════════════════════');

  assertSheetEnv();

  const sites = await readWebsiteConfigRows();
  if (sites.length === 0) {
    throw new Error(`${config.websiteConfig.tab} me koi site nahi mili.`);
  }

  const accountMap = await readAccountMap();
  const rows = await readRows();

  const issueWrites: Array<{ rowNumber: number; issue: string }> = [];
  const queueWrites: Array<{ rowNumber: number; updates: Record<string, string> }> = [];
  const logLines: Array<{ articleId: string; message: string }> = [];

  for (const site of sites) {
    const customerId =
      accountMap.get(siteKey(site.siteId)) ??
      (site.domain ? accountMap.get(siteKey(site.domain)) : undefined) ??
      '';

    if (!customerId) {
      const message = `${config.accountMap.tab} me is site ka Google Ads CID nahi hai`;
      logger.warn(`${site.siteId}: ${message}`);
      issueWrites.push({ rowNumber: site.rowNumber, issue: message });
      continue;
    }

    logger.blank();
    logger.info(`🔎 ${site.siteId} (${site.domain || '-'}) → account ${customerId}`);

    const health = await checkAccountHealth(customerId);
    logger.step(
      `${health.impressions} impressions, ${health.clicks} clicks, ${health.conversions} conversions`,
    );

    if (health.issues.length === 0) {
      logger.step('✅ koi dikkat nahi mili');
    } else {
      for (const issue of health.issues) logger.step(`⚠️  ${issue}`);
    }

    issueWrites.push({
      rowNumber: site.rowNumber,
      issue: health.issues.join(' | ').slice(0, config.health.maxIssueChars),
    });

    // Article wali dikkat usi row me aur ERROR_LOG me.
    if (config.health.writeArticleIssues) {
      for (const item of health.articleIssues) {
        if (!item.articleId) continue;
        logLines.push(item);

        const row = rows.find((r) => r.articleId === item.articleId);
        if (row && hasColumn('notes') && row.notes !== item.message) {
          queueWrites.push({ rowNumber: row.rowNumber, updates: { notes: item.message } });
        }
      }
    }
  }

  // --- Sheet me likhna ------------------------------------------------------
  const wrote = await writeWebsiteIssues(issueWrites);
  if (!wrote) {
    logger.warn(
      `${config.websiteConfig.tab} me "Issue" column nahi hai — ` +
        'wahan column bana do, phir saaransh wahin likha jayega.',
    );
  } else {
    logger.blank();
    logger.info(`📄 ${config.websiteConfig.tab} ki ${issueWrites.length} rows me Issue likh diya`);
  }

  if (queueWrites.length > 0) {
    await writeBackMany(queueWrites);
    logger.info(`📄 ${env.sheetTab} ki ${queueWrites.length} rows me wajah likh di`);
  }

  for (const line of logLines) {
    await appendErrorLog({
      articleId: line.articleId,
      message: line.message,
      retryStatus: 'HEALTH CHECK',
    });
  }
  if (logLines.length > 0) {
    logger.info(`📄 ${config.errorLog.tab} me ${logLines.length} line jodi`);
  }

  logger.blank();
}

void main().catch((error: unknown) => {
  logger.blank();
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
