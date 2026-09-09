import { config } from '../config.js';
import { withRetry } from './retry.js';
import type { ArticleRow, CampaignTemplate } from './types.js';

/** Every field the campaign builder cannot work without. */
export function assertRequiredFields(row: ArticleRow): void {
  const missing: string[] = [];
  if (!row.articleId) missing.push('Article ID');
  if (!row.liveUrl) missing.push('Live URL');
  if (!row.title && !row.topic) missing.push('Title ya Topic');
  if (missing.length > 0) {
    throw new Error(`Row me ye columns khaali hain: ${missing.join(', ')}`);
  }
}

function hostOf(value: string): string {
  return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
}

/** The Live URL must resolve, and (optionally) belong to the row's Website. */
export async function assertUrlReachable(row: ArticleRow): Promise<void> {
  let url: URL;
  try {
    url = new URL(row.liveUrl);
  } catch {
    throw new Error(`Live URL galat hai: ${row.liveUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Live URL http/https hona chahiye: ${row.liveUrl}`);
  }

  if (config.validation.matchUrlToWebsite && row.website) {
    let expected = row.website.trim();
    if (!/^https?:\/\//i.test(expected)) expected = `https://${expected}`;
    try {
      if (hostOf(expected) !== hostOf(row.liveUrl)) {
        throw new Error(
          `Live URL (${hostOf(row.liveUrl)}) Website column (${hostOf(expected)}) se match nahi karta.`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('match nahi karta')) throw error;
      // Website column me valid host nahi hai — is check ko skip kar dete hain.
    }
  }

  const response = await withRetry('Live URL check', () =>
    fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(config.validation.urlTimeoutMs),
    }),
  ).catch((error: unknown) => {
    throw new Error(`Live URL khul nahi raha: ${(error as Error).message}`);
  });

  if (!response.ok) {
    throw new Error(`Live URL ne ${response.status} status diya.`);
  }
}

/**
 * Row budget, capped by the template's Daily Budget Cap.
 * Template na mile to config wali limit chalti hai.
 */
export function resolveBudget(row: ArticleRow, template?: CampaignTemplate): number {
  const raw = row.budget.replace(/[^0-9.]/g, '');
  const value = raw ? Number(raw) : config.budget.defaultDailyBudget;

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Budget value galat hai: "${row.budget}"`);
  }

  const cap = template?.dailyBudgetCap ?? config.budget.maxDailyBudget;
  const capSource = template?.dailyBudgetCap
    ? `${config.campaignTemplates.tab} ke "${template.name}" template ka Daily Budget Cap`
    : 'config.ts ka maxDailyBudget';

  if (value > cap) {
    throw new Error(`Budget ${value} limit ${cap} se zyada hai (${capSource}).`);
  }
  return value;
}

/** GEO code from the row, checked against the template's (or config's) allowed list. */
export function resolveGeo(
  row: ArticleRow,
  template?: CampaignTemplate,
): { geo: string; geoTargetId: number } {
  const geo = (row.geo || config.defaultGeo).trim().toUpperCase();

  const fromTemplate = template?.allowedGeos ?? [];
  const allowed: readonly string[] = fromTemplate.length > 0 ? fromTemplate : config.allowedGeos;
  if (!allowed.includes(geo)) {
    const where =
      fromTemplate.length > 0
        ? `"${template?.name}" template ke Allowed GEOs`
        : 'config.ts -> allowedGeos';
    throw new Error(`GEO "${geo}" allowed list me nahi hai (${where}).`);
  }
  const geoTargetId = config.geoTargetIds[geo];
  if (!geoTargetId) {
    throw new Error(`GEO "${geo}" ka Google geo target id config.ts me nahi mila.`);
  }
  return { geo, geoTargetId };
}

export function resolveLanguageId(): number {
  const id = config.languageIds[config.defaultLanguage];
  if (!id) {
    throw new Error(`Language "${config.defaultLanguage}" ka id config.ts me nahi mila.`);
  }
  return id;
}
