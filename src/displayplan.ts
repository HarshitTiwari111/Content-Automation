import { config } from '../config.js';
import { sentence, smartTrim } from './adcopy.js';
import { generateAiPlan } from './aicopy.js';
import { logger } from './logger.js';
import type { ArticleRow, CampaignTemplate, DisplayAdCopy, DisplayPlan } from './types.js';
import {
  assertRequiredFields,
  assertUrlReachable,
  resolveBudget,
  resolveGeo,
  resolveLanguageId,
} from './validate.js';

/**
 * Display campaign ka plan (PDF section 9).
 * Search ke plan jaisa hi hai, sirf ad copy ke naap alag hain aur keywords
 * nahi lagte.
 */

function siteLabel(row: ArticleRow, resolvedSiteId?: string): string {
  if (resolvedSiteId) return resolvedSiteId.trim().toUpperCase();
  if (row.siteId) return row.siteId.trim().toUpperCase();
  const website = row.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ?? '';
  return (website || 'SITE').toUpperCase();
}

/** SITE | ARTICLE_ID | DISPLAY | GEO | TEMPLATE */
export function displayCampaignName(
  row: ArticleRow,
  geo: string,
  resolvedSiteId?: string,
): string {
  return config.campaignNamePattern
    .replace('{site}', siteLabel(row, resolvedSiteId))
    .replace('{article_id}', row.articleId)
    .replace('SEARCH', config.display.channel)
    .replace('{geo}', geo)
    .replace('{template}', (row.template || config.defaultTemplate).toUpperCase());
}

function titleCase(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Display ki copy. AI ki lines wahi hain jo Search ke liye banti hain —
 * bas yahan Google ke alag limits lagte hain (5 headlines, 1 long headline,
 * 5 descriptions, business name).
 */
function buildDisplayCopy(
  row: ArticleRow,
  aiHeadlines: string[],
  aiDescriptions: string[],
): DisplayAdCopy {
  const limits = config.display.rda;

  const headlines = aiHeadlines
    .map((line) => smartTrim(line, limits.headlineMaxChars))
    .filter(Boolean)
    .slice(0, limits.maxHeadlines);

  const descriptions = aiDescriptions
    .map((line) => sentence(line, limits.descriptionMaxChars))
    .filter(Boolean)
    .slice(0, limits.maxDescriptions);

  // Long headline 90 tak ja sakti hai — article ka title usme aaram se aata hai.
  const longHeadline = smartTrim(
    titleCase(row.title || row.topic),
    limits.longHeadlineMaxChars,
  );

  // Business name = site ka naam (brand column, warna domain).
  const businessName = smartTrim(
    titleCase(row.brand) ||
      row.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ||
      'Website',
    limits.businessNameMaxChars,
  );

  if (headlines.length < limits.minHeadlines) {
    throw new Error('Display ad ke liye ek bhi headline nahi bani.');
  }
  if (descriptions.length < limits.minDescriptions) {
    throw new Error('Display ad ke liye ek bhi description nahi bani.');
  }
  if (!longHeadline) {
    throw new Error('Long headline nahi bani — Title/Topic khaali hai.');
  }

  return { headlines, longHeadline, descriptions, businessName };
}

/** Ek row ko poore Display plan me badalta hai. */
export async function buildDisplayPlan(
  row: ArticleRow,
  customerId: string,
  resolvedSiteId?: string,
  template?: CampaignTemplate,
): Promise<DisplayPlan> {
  assertRequiredFields(row);

  if (!row.featuredImage) {
    throw new Error(
      'Featured Image column khaali hai — Display ad bina image ke ban hi nahi sakta.',
    );
  }

  const dailyBudget = resolveBudget(row, template);
  const { geo, geoTargetId } = resolveGeo(row, template);
  const languageId = resolveLanguageId();

  await assertUrlReachable(row);

  const ai = await generateAiPlan(row);
  if (!ai) {
    throw new Error(
      'AI se ad copy nahi bani — Display ad ke liye copy zaroori hai. ' +
        'OPENAI_API_KEY check karo.',
    );
  }
  logger.step('🤖 Ad copy AI se bani');

  const adCopy = buildDisplayCopy(row, ai.copy.headlines, ai.copy.descriptions);

  return {
    row,
    customerId,
    campaignName: displayCampaignName(row, geo, resolvedSiteId),
    dailyBudget,
    cpcBid: template?.maxBid ?? config.defaultCpcBid,
    geo,
    geoTargetId,
    languageId,
    finalUrl: row.liveUrl,
    finalUrlSuffix: config.display.utmSuffix.replace('{article_id}', row.articleId),
    adCopy,
    imageUrl: row.featuredImage,
  };
}
