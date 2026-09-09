/**
 * Offline preview — no Sheet, no Google Ads, no credentials needed.
 * Shows exactly which keywords and ad copy would be generated for a sample
 * article, so the output can be checked before any account is connected.
 *
 *   npm run preview
 */
import { buildAdCopy } from '../src/adcopy.js';
import { buildKeywords } from '../src/keywords.js';
import { campaignName } from '../src/plan.js';
import type { ArticleRow } from '../src/types.js';

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

const { criteria, texts } = buildKeywords(sample);
const copy = buildAdCopy(sample);

console.log(`\nCampaign name : ${campaignName(sample, sample.geo)}`);
console.log(`Final URL     : ${sample.liveUrl}?utm_source=google&utm_medium=cpc&utm_campaign=${sample.articleId}`);

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
