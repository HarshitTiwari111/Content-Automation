import { config } from '../config.js';
import { sentence, smartTrim, validateAdCopy } from './adcopy.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import type { AdCopy, ArticleRow } from './types.js';

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

  return `You write Google Ads Responsive Search Ad copy for an article landing page.

${facts}

Write ${config.ai.askHeadlines} headlines and ${config.ai.askDescriptions} descriptions in English.

Rules:
- Headlines: ${config.rsa.headlineMaxChars} characters or fewer, each one distinct.
- Descriptions: ${config.rsa.descriptionMaxChars} characters or fewer.
- Stay true to the article. Do not invent prices, discounts, ratings, guarantees or statistics.
- No superlatives you cannot back up ("the best", "number 1", "cheapest").
- No phone numbers, no ALL CAPS words, no more than one exclamation mark overall.
- Vary the angle: what the reader learns, who it helps, what problem it solves.

Reply with JSON only, in this exact shape:
{"headlines": ["..."], "descriptions": ["..."]}`;
}

/** AI ki lines ko Google ki limit ke andar laata hai aur kachra hata deta hai. */
function cleanLines(lines: unknown, max: number, limit: number, asSentence: boolean): string[] {
  if (!Array.isArray(lines)) return [];

  const out: string[] = [];
  for (const raw of lines) {
    if (typeof raw !== 'string') continue;
    const trimmed = asSentence ? sentence(raw, limit) : smartTrim(raw, limit);
    if (!trimmed || trimmed.length > limit) continue;
    if (out.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    out.push(trimmed);
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
export async function generateAiAdCopy(row: ArticleRow): Promise<AdCopy | null> {
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

    const json = JSON.parse(content) as { headlines?: unknown; descriptions?: unknown };

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
      path1: toPath(row.category),
      path2: '',
    };
    copy.path2 = copy.path1 ? toPath(row.brand) : '';

    // Google ka minimum pura nahi hua to AI ka jawab bekaar hai.
    validateAdCopy(copy);
    return copy;
  } catch (error) {
    logger.warn(
      `AI ad copy nahi bani (${error instanceof Error ? error.message : String(error)}) — ` +
        'purane tarike se bana rahe hain.',
    );
    return null;
  }
}
