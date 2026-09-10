/**
 * Keywords aur ad copy ka preview — Google Ads ko kuch nahi bhejta.
 *
 *   npm run preview                      → nakli sample article
 *   npm run preview -- --article=GF-3232 → Sheet se asli article
 */
import { setDefaultResultOrder } from 'node:dns';
import { buildAdCopy } from '../src/adcopy.js';
import { generateAiPlan } from '../src/aicopy.js';
import { buildKeywords, toCriteria } from '../src/keywords.js';
import { campaignName } from '../src/plan.js';
import { readRows } from '../src/sheet.js';
import type { ArticleRow } from '../src/types.js';

setDefaultResultOrder('ipv4first');

const wantedArticle = process.argv.find((a) => a.startsWith('--article='))?.split('=')[1];

const sample: ArticleRow = {
  rowNumber: 2,
  articleId: 'A0182',
  siteId: 'SITE1',
  website: 'https://www.example.com',
  brand: 'Vans',
  category: 'Running Shoes',
  topic: 'how to choose running shoes for beginners',
  title: 'Best Running Shoes for Beginners in 2026: A Complete Guide',
  liveUrl: 'https://www.example.com/best-running-shoes',
  search: 'YES',
  geo: 'US',
  template: 'TEST20',
  budget: '300',
  searchCampaignId: '',
  status: 'TRAFFIC_READY',
  notes: '',
};

async function pickRow(): Promise<ArticleRow> {
  if (!wantedArticle) return sample;

  const rows = await readRows();
  const found = rows.find((r) => r.articleId.toLowerCase() === wantedArticle.toLowerCase());
  if (!found) throw new Error(`Article "${wantedArticle}" CONTENT_QUEUE me nahi mila.`);
  return found;
}

async function main(): Promise<void> {
const sampleRow = await pickRow();
const ai = await generateAiPlan(sampleRow);
const fallback = buildKeywords(sampleRow);
const texts = ai && ai.keywords.length >= 2 ? ai.keywords : fallback.texts;
const criteria = ai && ai.keywords.length >= 2 ? toCriteria(texts) : fallback.criteria;
const copy = ai?.copy ?? buildAdCopy(sampleRow);
console.log(`
Ad copy source: ${ai ? "🤖 AI" : "article ke shabdon se (AI nahi chala)"}`);

console.log(`\nCampaign name : ${campaignName(sampleRow, sampleRow.geo || "US")}`);
console.log(`Final URL     : ${sampleRow.liveUrl}?utm_source=google&utm_medium=cpc&utm_campaign=${sampleRow.articleId}`);

console.log(`\nKEYWORDS (${texts.length} texts → ${criteria.length} criteria)`);
for (const text of texts) console.log(`  - ${text}`);

console.log(`\nHEADLINES (${copy.headlines.length}, limit 30 chars)`);
for (const headline of copy.headlines) {
  console.log(`  [${String(headline.length).padStart(2)}] ${headline}`);
}

console.log(`\nDESCRIPTIONS (${copy.descriptions.length}, limit 90 chars)`);
for (const description of copy.descriptions) {
  console.log(`  [${String(description.length).padStart(2)}] ${description}`);
}

console.log(`\nDisplay path  : /${copy.path1}${copy.path2 ? `/${copy.path2}` : ''}`);
console.log('');
}

void main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
