import { config } from '../config.js';
import { sentence, smartTrim, validateAdCopy } from './adcopy.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import { filterKeywordTexts } from './keywords.js';
import type { AdCopy, ArticleRow } from './types.js';

/** AI ka poora jawab — keywords + copy. */
export interface AiPlan {
  keywords: string[];
  copy: AdCopy;
}

/**
 * AI se RSA ki copy (PDF section 16: "AI model/API for ... ad-copy generation").
 *
 * Ye hissa jaanbujh ke "best effort" hai — AI band ho, key na ho, ya jawab
 * bekaar aaye, to null wapas karta hai aur purana (article ke shabdon wala)
 * tarika chal jaata hai. Campaign banna kabhi nahi rukta.
 */

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** AI ko article ka poora sandarbh aur Google ke rules batata hai. */
function buildPrompt(row: ArticleRow): string {
  const facts = [
    `Article title: ${row.title || row.topic}`,
    row.topic && row.topic !== row.title ? `Topic / search intent: ${row.topic}` : '',
    row.category ? `Category: ${row.category}` : '',
    row.brand ? `Brand: ${row.brand}` : '',
    row.liveUrl ? `Landing page: ${row.liveUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `You plan a Google Ads Search campaign for an article landing page.

${facts}

Produce three things in English:

1. ${config.ai.askKeywords} search keywords people would actually type on Google to find this article.
   - ${config.keywords.minWords} to ${config.keywords.maxWords} words each, lowercase, no punctuation.
   - Match the article's real subject and intent. No brand names of other companies.
   - Do not include the publisher's own site name.

2. ${config.ai.askHeadlines} headlines, ${config.rsa.headlineMaxChars} characters or fewer, each one distinct.
   - Start each headline with a capital letter (normal sentence case, not lowercase).

3. ${config.ai.askDescriptions} descriptions, ${config.rsa.descriptionMaxChars} characters or fewer.
   - Normal sentence case, ending with a full stop.

Rules for all of it:
- Stay true to the article. Do not invent prices, discounts, ratings, guarantees or statistics.
- No superlatives you cannot back up ("the best", "number 1", "cheapest").
- No phone numbers, no ALL CAPS words, no more than one exclamation mark overall.
- Vary the angle: what the reader learns, who it helps, what problem it solves.

Reply with JSON only, in this exact shape:
{"keywords": ["..."], "headlines": ["..."], "descriptions": ["..."]}`;
}

/** AI ki lines ko Google ki limit ke andar laata hai aur kachra hata deta hai. */
function cleanLines(lines: unknown, max: number, limit: number, asSentence: boolean): string[] {
  if (!Array.isArray(lines)) return [];

  const out: string[] = [];
  for (const raw of lines) {
    if (typeof raw !== 'string') continue;
    const trimmed = asSentence ? sentence(raw, limit) : smartTrim(raw, limit);
    if (!trimmed || trimmed.length > limit) continue;
    // AI kabhi-kabhi poori line lowercase bhej deta hai — pehla akshar bada kar dete hain.
    const fixed = trimmed[0] === trimmed[0]?.toLowerCase()
      ? trimmed[0]!.toUpperCase() + trimmed.slice(1)
      : trimmed;
    if (out.some((existing) => existing.toLowerCase() === fixed.toLowerCase())) continue;
    out.push(fixed);
    if (out.length >= max) break;
  }
  return out;
}

/** URL path pieces: letters and digits only. */
function toPath(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, config.rsa.pathMaxChars);
}

/**
 * AI se copy banwata hai. Na ban paye to null — caller purana tarika use karega.
 */
export async function generateAiPlan(row: ArticleRow): Promise<AiPlan | null> {
  if (!config.ai.enabled || !env.openAi.apiKey) return null;

  try {
    const response = await withRetry('AI ad copy', () =>
      fetch(`${env.openAi.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.openAi.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.openAi.model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: buildPrompt(row) }],
        }),
        signal: AbortSignal.timeout(config.ai.timeoutMs),
      }),
    );

    const text = await response.text();
    if (!response.ok) {
      logger.warn(`AI ad copy nahi bani (HTTP ${response.status}) — purane tarike se bana rahe hain.`);
      return null;
    }

    const parsed = JSON.parse(text) as ChatResponse;
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) return null;

    const json = JSON.parse(content) as {
      keywords?: unknown;
      headlines?: unknown;
      descriptions?: unknown;
    };

    const copy: AdCopy = {
      headlines: cleanLines(
        json.headlines,
        config.rsa.maxHeadlines,
        config.rsa.headlineMaxChars,
        false,
      ),
      descriptions: cleanLines(
        json.descriptions,
        config.rsa.maxDescriptions,
        config.rsa.descriptionMaxChars,
        true,
      ),
      // Google ka rule: path2 tabhi jab path1 ho. Category na ho to brand se path1.
      path1: toPath(row.category) || toPath(row.brand),
      path2: '',
    };
    if (copy.path1 && copy.path1 === toPath(row.category)) {
      copy.path2 = toPath(row.brand);
    }

    // Google ka minimum pura nahi hua to AI ka jawab bekaar hai.
    validateAdCopy(copy);

    const keywords = Array.isArray(json.keywords)
      ? filterKeywordTexts(row, json.keywords.filter((k): k is string => typeof k === 'string'))
      : [];

    return { keywords, copy };
  } catch (error) {
    logger.warn(
      `AI ad copy nahi bani (${error instanceof Error ? error.message : String(error)}) — ` +
        'purane tarike se bana rahe hain.',
    );
    return null;
  }
}
