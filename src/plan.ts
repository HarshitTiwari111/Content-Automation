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

function siteLabel(row: ArticleRow): string {
  if (row.siteId) return row.siteId.trim().toUpperCase();
  const website = row.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ?? '';
  return (website || 'SITE').toUpperCase();
}

/** SITE | ARTICLE_ID | SEARCH | GEO | TEMPLATE */
export function campaignName(row: ArticleRow, geo: string): string {
  return config.campaignNamePattern
    .replace('{site}', siteLabel(row))
    .replace('{article_id}', row.articleId)
    .replace('{geo}', geo)
    .replace('{template}', (row.template || config.defaultTemplate).toUpperCase());
}

/**
 * Turns one Sheet row into a fully validated campaign plan.
 * Nothing here talks to Google Ads — so a dry run executes this exact code path.
 */
export async function buildPlan(row: ArticleRow, customerId: string): Promise<CampaignPlan> {
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
    campaignName: campaignName(row, geo),
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
