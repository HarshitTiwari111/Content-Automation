import { config } from '../config.js';
import type { ArticleRow, KeywordCriterion } from './types.js';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'from', 'is', 'are', 'was', 'were', 'be', 'been', 'that', 'this', 'these', 'those', 'it',
  'its', 'as', 'you', 'your', 'we', 'our', 'they', 'their', 'what', 'why', 'when', 'which',
  'about', 'into', 'over', 'after', 'before', 'more', 'most', 'can', 'will', 'do', 'does',
]);

/** Suffix ideas that keep the search intent informational and policy-safe. */
const MODIFIERS = ['guide', 'tips', 'checklist', 'ideas', 'options', 'comparison'];
const PREFIXES = ['best', 'top'];

/** lowercase, strip punctuation, collapse spaces. */
function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return clean(text).split(' ').filter(Boolean);
}

/** Drops stopwords but keeps the original order. */
function coreWords(text: string): string[] {
  return words(text).filter((w) => !STOPWORDS.has(w) && w.length > 1);
}

function isAllowed(keyword: string): boolean {
  const parts = keyword.split(' ');
  if (parts.length < config.keywords.minWords) return false;
  if (parts.length > config.keywords.maxWords) return false;
  if (keyword.length > 80) return false;
  if (/^\d+$/.test(keyword.replace(/\s/g, ''))) return false;
  return !config.keywords.bannedWords.some((banned) => parts.includes(banned));
}

/**
 * Builds keyword texts from the article's title, topic, brand and category.
 * Deterministic on purpose — same row always produces the same keywords, so a
 * dry run shows exactly what the live run will create.
 */
export function generateKeywordTexts(row: ArticleRow): string[] {
  const titleCore = coreWords(row.title || row.topic);
  const topicCore = coreWords(row.topic);
  const brand = clean(row.brand);
  const category = clean(row.category);

  const head = titleCore.slice(0, 5).join(' ');
  const shortHead = titleCore.slice(0, 3).join(' ');
  const pairHead = titleCore.slice(0, 2).join(' ');

  const candidates: string[] = [
    head,
    shortHead,
    pairHead,
    topicCore.slice(0, config.keywords.maxWords).join(' '),
    category,
    brand && category ? `${brand} ${category}` : '',
    brand && shortHead ? `${brand} ${shortHead}` : '',
  ];

  // "best best running shoes" / "top best running shoes" jaisa repeat na ho.
  const headHasPrefix = PREFIXES.some((p) => shortHead.startsWith(p));
  for (const prefix of PREFIXES) {
    if (category && !category.includes(prefix)) candidates.push(`${prefix} ${category}`);
    if (shortHead && !headHasPrefix) candidates.push(`${prefix} ${shortHead}`);
  }

  for (const modifier of MODIFIERS) {
    if (shortHead && !shortHead.includes(modifier)) candidates.push(`${shortHead} ${modifier}`);
    if (category && !category.includes(modifier)) candidates.push(`${category} ${modifier}`);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const keyword = clean(candidate);
    if (!keyword || seen.has(keyword) || !isAllowed(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
    if (result.length >= config.keywords.maxKeywords) break;
  }

  return result;
}

/** Expands each keyword text into the configured match types, respecting the cap. */
export function toCriteria(texts: string[]): KeywordCriterion[] {
  const criteria: KeywordCriterion[] = [];
  for (const matchType of config.keywords.matchTypes) {
    for (const text of texts) {
      if (criteria.length >= config.keywords.maxCriteria) return criteria;
      criteria.push({ text, matchType });
    }
  }
  return criteria;
}

/** Global negatives plus the banned word list. */
export function negativeKeywords(): string[] {
  return [...new Set([...config.keywords.negatives, ...config.keywords.bannedWords])];
}

/** Throws when an article cannot produce enough usable keywords. */
export function buildKeywords(row: ArticleRow): {
  criteria: KeywordCriterion[];
  texts: string[];
  negatives: string[];
} {
  const texts = generateKeywordTexts(row);
  if (texts.length < 2) {
    throw new Error(
      'Keywords generate nahi hue — Title/Topic/Category columns bahut chhote ya khaali hain.',
    );
  }
  return { criteria: toCriteria(texts), texts, negatives: negativeKeywords() };
}
