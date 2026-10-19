import { config } from '../config.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import { adsAllowedByCategory, hasColumn, isErrorRow, writeBackMany } from './sheet.js';
import type { ArticleRow } from './types.js';

/**
 * Display ke liye row taiyar karna — wo kaam jo pehle haath se hota tha:
 *   1. Post Category = Brand hai to Display (Y/N) me "Yes" likhna
 *   2. Live URL kholke us article ki featured image ka link uthana aur
 *      Featured Image column me likhna
 *
 * Bhari hui cell ko kabhi nahi badalta — sirf khaali jagah bharta hai.
 */

/** Page ke HTML se featured image ka link. Na mile to ''. */
export async function findFeaturedImage(pageUrl: string): Promise<string> {
  const response = await withRetry('Live URL kholna', () =>
    fetch(pageUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(config.featuredImage.timeoutMs),
    }),
  );
  if (!response.ok) throw new Error(`Live URL ne ${response.status} status diya.`);

  const html = await response.text();

  // Wahi link jo Facebook/Google page preview me dikhate hain.
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const found = html.match(pattern)?.[1]?.trim();
    if (found && /^https?:\/\//i.test(found)) return found;
  }
  return '';
}

/** Is row par Display chalna chahiye (Category = Brand) aur campaign abhi bani nahi. */
function needsDisplay(row: ArticleRow): boolean {
  return (
    adsAllowedByCategory(row) && row.displayCampaignId === '' && !isErrorRow(row) && row.liveUrl !== ''
  );
}

function saysYes(value: string): boolean {
  return ['yes', 'y', 'true'].includes(value.trim().toLowerCase());
}

/**
 * Rows ko taiyar karta hai aur jo badla, wo Sheet me ek hi baar me likh deta hai.
 * Dry run me kuch likhta nahi, sirf dikhata hai.
 */
export async function prepareDisplayRows(rows: ArticleRow[]): Promise<void> {
  const updates: Array<{ rowNumber: number; updates: Record<string, string> }> = [];

  // --- 1. Category = Brand -> Display (Y/N) = Yes --------------------------
  if (config.display.autoYesForBrand && hasColumn('display')) {
    const needYes = rows.filter((row) => needsDisplay(row) && !saysYes(row.display));
    for (const row of needYes) {
      row.display = 'Yes';
      updates.push({ rowNumber: row.rowNumber, updates: { display: 'Yes' } });
    }
    if (needYes.length > 0) {
      logger.info(
        `✍️  ${needYes.length} rows me Display (Y/N) = Yes ` +
          `(${needYes.slice(0, 5).map((r) => r.articleId).join(', ')}${needYes.length > 5 ? ' …' : ''})`,
      );
    }
  }

  // --- 2. Featured Image khaali ho to article ke page se uthao -------------
  if (config.featuredImage.autoFill && hasColumn('featuredImage')) {
    const needImage = rows
      .filter((row) => needsDisplay(row) && saysYes(row.display) && row.featuredImage === '')
      .slice(0, config.featuredImage.maxPerRun);

    for (const row of needImage) {
      try {
        const image = await findFeaturedImage(row.liveUrl);
        if (!image) {
          logger.warn(`${row.articleId}: page pe featured image nahi mili.`);
          continue;
        }
        row.featuredImage = image;

        const existing = updates.find((u) => u.rowNumber === row.rowNumber);
        if (existing) existing.updates.featuredImage = image;
        else updates.push({ rowNumber: row.rowNumber, updates: { featuredImage: image } });

        logger.step(`🖼️  ${row.articleId}: image mil gayi — ${image.slice(0, 80)}`);
      } catch (error) {
        logger.warn(
          `${row.articleId}: image nahi laa paye — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (updates.length === 0) return;

  if (env.dryRun) {
    logger.info(`🧪 DRY RUN — ${updates.length} rows me likha jaata, par abhi kuch nahi likha.`);
    return;
  }

  await writeBackMany(updates);
  logger.info(`📄 ${env.sheetTab} ki ${updates.length} rows bhar di gayin`);
}
