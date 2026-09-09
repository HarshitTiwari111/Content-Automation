import { config } from '../config.js';
import type { AdCopy, ArticleRow } from './types.js';

/** Words an ad line should never end on after trimming. */
const TRAILING_JUNK = new Set([
  'for', 'and', 'the', 'a', 'an', 'in', 'on', 'of', 'to', 'with', 'at', 'by', 'or',
  'is', 'are', 'from', 'your', 'you', 'get', 'read', 'full',
]);

/** Removes dangling words/punctuation left behind by a hard cut. */
function stripTrailingJunk(text: string): string {
  const parts = text.split(' ').filter(Boolean);
  while (parts.length > 1) {
    const last = (parts[parts.length - 1] ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (!TRAILING_JUNK.has(last)) break;
    parts.pop();
  }
  return parts.join(' ').replace(/[\s,:;—–-]+$/, '');
}

/** Cuts at a word boundary so ad lines never end mid-word or on a filler word. */
function smartTrim(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const sliced = (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
  return stripTrailingJunk(sliced);
}

/** Trims to fit and always ends with a full stop. */
function sentence(text: string, max: number): string {
  const trimmed = smartTrim(text, max - 1);
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function titleCase(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Generic, claim-free fallbacks so every ad reaches Google's minimum count. */
const FALLBACK_HEADLINES = [
  'Read The Full Guide',
  'Complete Guide Inside',
  'Expert Tips & Advice',
  'Everything Explained',
  'Step By Step Guide',
  'Quick Checklist Inside',
  'Compare Your Options',
  'Learn The Basics',
  'Practical Tips Inside',
  'Start Here',
];

const FALLBACK_DESCRIPTIONS = [
  'Clear, practical guide written to answer the questions people actually ask.',
  'Simple explanations, useful tips and a short checklist you can follow today.',
  'Everything covered in one page — read it in a few minutes and decide faster.',
  'Straightforward information, no jargon. Read the full guide on our site.',
];

function uniquePush(list: string[], value: string, max: number): void {
  const text = value.trim();
  if (!text) return;
  if (list.length >= max) return;
  if (list.some((existing) => existing.toLowerCase() === text.toLowerCase())) return;
  list.push(text);
}

/** URL path pieces: letters and digits only, max 15 chars each. */
function toPath(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, config.rsa.pathMaxChars);
}

/**
 * Builds Responsive Search Ad copy from the row.
 * Every headline/description is trimmed to Google's hard character limits
 * before it leaves this file, so the API never rejects the request.
 */
export function buildAdCopy(row: ArticleRow): AdCopy {
  const { headlineMaxChars, descriptionMaxChars, maxHeadlines, maxDescriptions } = config.rsa;

  const title = titleCase(row.title || row.topic);
  const category = titleCase(row.category);
  const brand = titleCase(row.brand);

  const headlines: string[] = [];
  uniquePush(headlines, smartTrim(title, headlineMaxChars), maxHeadlines);
  if (category) {
    uniquePush(headlines, smartTrim(category, headlineMaxChars), maxHeadlines);
    uniquePush(headlines, smartTrim(`${category} Guide`, headlineMaxChars), maxHeadlines);
    uniquePush(headlines, smartTrim(`Best ${category} Tips`, headlineMaxChars), maxHeadlines);
  }
  if (brand) {
    uniquePush(headlines, smartTrim(brand, headlineMaxChars), maxHeadlines);
    if (category) {
      uniquePush(headlines, smartTrim(`${brand} ${category}`, headlineMaxChars), maxHeadlines);
    }
  }
  for (const fallback of FALLBACK_HEADLINES) {
    uniquePush(headlines, smartTrim(fallback, headlineMaxChars), maxHeadlines);
  }

  const descriptions: string[] = [];
  if (title) {
    // Poora vaakya fit ho to accha, warna sirf title ka saaf version.
    const withCta = `${title} — read the full guide and get the details you need.`;
    uniquePush(
      descriptions,
      withCta.length <= descriptionMaxChars ? withCta : sentence(title, descriptionMaxChars),
      maxDescriptions,
    );
  }
  if (category) {
    uniquePush(
      descriptions,
      sentence(
        `A practical ${category.toLowerCase()} guide with clear steps and useful tips`,
        descriptionMaxChars,
      ),
      maxDescriptions,
    );
  }
  for (const fallback of FALLBACK_DESCRIPTIONS) {
    uniquePush(descriptions, smartTrim(fallback, descriptionMaxChars), maxDescriptions);
  }

  const copy: AdCopy = {
    headlines,
    descriptions,
    path1: toPath(row.category || 'guide'),
    path2: toPath(row.brand || ''),
  };

  validateAdCopy(copy);
  return copy;
}

/** Last safety gate before anything is sent to Google Ads. */
export function validateAdCopy(copy: AdCopy): void {
  const { headlineMaxChars, descriptionMaxChars, minHeadlines, minDescriptions } = config.rsa;

  if (copy.headlines.length < minHeadlines) {
    throw new Error(`RSA ko kam se kam ${minHeadlines} headlines chahiye, mile ${copy.headlines.length}.`);
  }
  if (copy.descriptions.length < minDescriptions) {
    throw new Error(
      `RSA ko kam se kam ${minDescriptions} descriptions chahiye, mile ${copy.descriptions.length}.`,
    );
  }

  const longHeadline = copy.headlines.find((h) => h.length > headlineMaxChars);
  if (longHeadline) {
    throw new Error(`Headline ${headlineMaxChars} character se badi hai: "${longHeadline}"`);
  }
  const longDescription = copy.descriptions.find((d) => d.length > descriptionMaxChars);
  if (longDescription) {
    throw new Error(`Description ${descriptionMaxChars} character se badi hai: "${longDescription}"`);
  }
}
