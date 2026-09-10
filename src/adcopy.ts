import { config } from '../config.js';
import type { AdCopy, ArticleRow } from './types.js';

/**
 * RSA ki poori copy article ke apne data se banti hai —
 * Title, Topic/Intent, Category aur Brand.
 *
 * Code me koi tayaar headline/description nahi rakhi gayi. Agar article se
 * Google ka minimum (3 headlines, 2 descriptions) nahi banta, to wo row fail
 * hoti hai — generic copy bhejne se behtar hai saaf bata dena.
 */

/** Words an ad line should never end on after trimming. */
const TRAILING_JUNK = new Set([
  'for', 'and', 'the', 'a', 'an', 'in', 'on', 'of', 'to', 'with', 'at', 'by', 'or',
  'is', 'are', 'from', 'your', 'you',
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
export function smartTrim(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const sliced = (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
  return stripTrailingJunk(sliced);
}

/** Trims to fit and always ends with a full stop. */
export function sentence(text: string, max: number): string {
  const trimmed = smartTrim(text, max - 1);
  if (!trimmed) return '';
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

/** Article ke text ke pehle N shabd. */
function firstWords(text: string, count: number): string {
  return text.split(' ').filter(Boolean).slice(0, count).join(' ');
}

function uniquePush(list: string[], value: string, max: number): void {
  const text = stripTrailingJunk(value.trim());
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
 * Har line article ke shabdon se banti hai, aur Google ki character limit ke
 * andar trim hoti hai — taaki API kabhi reject na kare.
 */
export function buildAdCopy(row: ArticleRow): AdCopy {
  const { headlineMaxChars, descriptionMaxChars, maxHeadlines, maxDescriptions } = config.rsa;

  const title = titleCase(row.title || row.topic);
  const topic = titleCase(row.topic);
  const category = titleCase(row.category);
  const brand = titleCase(row.brand);

  // --- Headlines: title/topic ke tukde + category + brand ------------------
  const headlines: string[] = [];

  uniquePush(headlines, smartTrim(title, headlineMaxChars), maxHeadlines);
  for (const count of [5, 4, 3, 2]) {
    uniquePush(headlines, smartTrim(firstWords(title, count), headlineMaxChars), maxHeadlines);
  }

  if (topic && topic !== title) {
    uniquePush(headlines, smartTrim(topic, headlineMaxChars), maxHeadlines);
    for (const count of [4, 3]) {
      uniquePush(headlines, smartTrim(firstWords(topic, count), headlineMaxChars), maxHeadlines);
    }
  }

  if (category) {
    uniquePush(headlines, smartTrim(category, headlineMaxChars), maxHeadlines);
    if (brand) {
      uniquePush(headlines, smartTrim(`${brand} ${category}`, headlineMaxChars), maxHeadlines);
    }
  }
  if (brand) {
    uniquePush(headlines, smartTrim(brand, headlineMaxChars), maxHeadlines);
  }

  // --- Descriptions: article ke lambe hisse -------------------------------
  const descriptions: string[] = [];

  if (title) uniquePush(descriptions, sentence(title, descriptionMaxChars), maxDescriptions);
  if (topic && topic !== title) {
    uniquePush(descriptions, sentence(topic, descriptionMaxChars), maxDescriptions);
  }
  if (title && category) {
    uniquePush(descriptions, sentence(`${title} — ${category}`, descriptionMaxChars), maxDescriptions);
  }
  if (topic && category && topic !== title) {
    uniquePush(descriptions, sentence(`${category}: ${topic}`, descriptionMaxChars), maxDescriptions);
  }

  // Google ka rule: path2 tabhi de sakte hain jab path1 bhi ho.
  // Category khaali hui to path1 nahi banta — tab path2 bhi nahi bhejna.
  const path1 = toPath(row.category) || toPath(row.brand);
  const path2 = path1 === toPath(row.category) ? toPath(row.brand) : '';

  const copy: AdCopy = {
    headlines,
    descriptions,
    path1,
    path2: path1 ? path2 : '',
  };

  validateAdCopy(copy);
  return copy;
}

/** Last safety gate before anything is sent to Google Ads. */
export function validateAdCopy(copy: AdCopy): void {
  const { headlineMaxChars, descriptionMaxChars, minHeadlines, minDescriptions } = config.rsa;

  if (copy.headlines.length < minHeadlines) {
    throw new Error(
      `Article se sirf ${copy.headlines.length} headline bani, Google ko kam se kam ` +
        `${minHeadlines} chahiye. Title/Topic/Category columns bhar do.`,
    );
  }
  if (copy.descriptions.length < minDescriptions) {
    throw new Error(
      `Article se sirf ${copy.descriptions.length} description bani, Google ko kam se kam ` +
        `${minDescriptions} chahiye. Title/Topic/Category columns bhar do.`,
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
