import { config } from '../config.js';
import { buildAdCopy } from './adcopy.js';
import { buildKeywords } from './keywords.js';
import type { ArticleRow, CampaignPlan } from './types.js';
import {
  assertRequiredFields,
  assertUrlReachable,
  resolveBudget,
  resolveGeo,
  resolveLanguageId,
} from './validate.js';

/**
 * Campaign ke naam me site ka chhota code aata hai (SITE-4), poora domain nahi.
 * Pehle WEBSITE_CONFIG se mila hua code, phir row ka Site ID, aakhir me domain.
 */
function siteLabel(row: ArticleRow, resolvedSiteId?: string): string {
  if (resolvedSiteId) return resolvedSiteId.trim().toUpperCase();
  if (row.siteId) return row.siteId.trim().toUpperCase();
  const website = row.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ?? '';
  return (website || 'SITE').toUpperCase();
}

/** SITE | ARTICLE_ID | SEARCH | GEO | TEMPLATE */
export function campaignName(row: ArticleRow, geo: string, resolvedSiteId?: string): string {
  return config.campaignNamePattern
    .replace('{site}', siteLabel(row, resolvedSiteId))
    .replace('{article_id}', row.articleId)
    .replace('{geo}', geo)
    .replace('{template}', (row.template || config.defaultTemplate).toUpperCase());
}

/**
 * Turns one Sheet row into a fully validated campaign plan.
 * Nothing here talks to Google Ads — so a dry run executes this exact code path.
 */
export async function buildPlan(
  row: ArticleRow,
  customerId: string,
  resolvedSiteId?: string,
): Promise<CampaignPlan> {
  assertRequiredFields(row);

  const dailyBudget = resolveBudget(row);
  const { geo, geoTargetId } = resolveGeo(row);
  const languageId = resolveLanguageId();

  await assertUrlReachable(row);

  const { criteria, negatives } = buildKeywords(row);
  const adCopy = buildAdCopy(row);

  return {
    row,
    customerId,
    campaignName: campaignName(row, geo, resolvedSiteId),
    dailyBudget,
    cpcBid: config.defaultCpcBid,
    geo,
    geoTargetId,
    languageId,
    finalUrl: row.liveUrl,
    finalUrlSuffix: config.utmSuffix.replace('{article_id}', row.articleId),
    keywords: criteria,
    negatives,
    adCopy,
  };
}
