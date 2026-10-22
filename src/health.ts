import { config } from '../config.js';
import { searchAds } from './googleads.js';

/**
 * Account ki jaanch — kahin budget to khatam nahi, ad disapproved to nahi,
 * campaign chal bhi rahi hai ya nahi. Sirf padhta hai, kuch badalta nahi.
 */

export interface ArticleIssue {
  articleId: string;
  message: string;
}

export interface AccountHealth {
  /** Site ke saamne likhne wale chhote jumle. */
  issues: string[];
  /** Kis article me kya dikkat — CONTENT_QUEUE/ERROR_LOG ke liye. */
  articleIssues: ArticleIssue[];
  clicks: number;
  impressions: number;
  conversions: number;
}

interface AdsRow {
  [key: string]: unknown;
}

function toUnits(micros: unknown): number {
  const n = Number(micros ?? 0);
  return Number.isFinite(n) ? Math.round((n / 1_000_000) * 100) / 100 : 0;
}

/** Campaign ke naam "SITE-4 | GF-3834 | DISPLAY | US | HEALTH" se Article ID. */
export function articleIdFromCampaignName(name: string): string {
  return (name.split('|')[1] ?? '').trim();
}

/** Policy ka naam padhne layak banata hai: PRESCRIPTION_DRUG_SALE -> prescription drug sale */
function readableTopic(topic: string): string {
  return topic.replace(/_/g, ' ').toLowerCase();
}

export async function checkAccountHealth(customerId: string): Promise<AccountHealth> {
  const issues: string[] = [];
  const articleIssues: ArticleIssue[] = [];
  const days = config.health.lookbackDays;

  // --- 1. Account khud chalu hai ya nahi ------------------------------------
  try {
    const r = (await searchAds(
      customerId,
      'SELECT customer.status FROM customer',
    )) as { results?: Array<{ customer?: { status?: string } }> };
    const status = r.results?.[0]?.customer?.status ?? '';
    if (status && status !== 'ENABLED') issues.push(`Account ka status ${status} hai`);
  } catch (error) {
    issues.push(`Account padha nahi ja saka: ${(error as Error).message.slice(0, 80)}`);
    return { issues, articleIssues, clicks: 0, impressions: 0, conversions: 0 };
  }

  // --- 2. Account budget khatam to nahi -------------------------------------
  try {
    const r = (await searchAds(
      customerId,
      'SELECT account_budget.status, account_budget.approved_spending_limit_micros, ' +
        'account_budget.adjusted_spending_limit_micros, account_budget.amount_served_micros ' +
        "FROM account_budget WHERE account_budget.status = 'APPROVED'",
    )) as { results?: Array<{ accountBudget?: AdsRow }> };

    for (const row of r.results ?? []) {
      const b = row.accountBudget ?? {};
      const limit = toUnits(b.adjustedSpendingLimitMicros ?? b.approvedSpendingLimitMicros);
      const used = toUnits(b.amountServedMicros);
      if (limit <= 0) continue;
      if (used >= limit) issues.push(`Account budget khatam (${used}/${limit})`);
      else if (used >= limit * config.health.budgetWarnRatio) {
        issues.push(`Account budget khatam hone wala hai (${used}/${limit})`);
      }
    }
  } catch {
    // Card wale accounts me account_budget hota hi nahi — koi baat nahi.
  }

  // --- 3. Pichhle kuch din ka kaam ------------------------------------------
  let clicks = 0;
  let impressions = 0;
  let conversions = 0;
  try {
    const r = (await searchAds(
      customerId,
      'SELECT metrics.clicks, metrics.impressions, metrics.all_conversions FROM customer ' +
        `WHERE segments.date DURING LAST_${days}_DAYS`,
    )) as { results?: Array<{ metrics?: AdsRow }> };
    for (const row of r.results ?? []) {
      clicks += Number(row.metrics?.clicks ?? 0);
      impressions += Number(row.metrics?.impressions ?? 0);
      conversions += Number(row.metrics?.allConversions ?? 0);
    }
  } catch {
    // metrics na mile to aage badho.
  }

  // --- 4. Campaigns ka haal --------------------------------------------------
  let enabledCampaigns = 0;
  try {
    const r = (await searchAds(
      customerId,
      'SELECT campaign.name, campaign.status, campaign.primary_status, ' +
        "campaign.primary_status_reasons FROM campaign WHERE campaign.status = 'ENABLED'",
    )) as { results?: Array<{ campaign?: AdsRow }> };

    let limited = 0;
    const notEligible: string[] = [];
    for (const row of r.results ?? []) {
      const c = row.campaign ?? {};
      enabledCampaigns += 1;
      const primary = String(c.primaryStatus ?? '');
      if (primary === 'LIMITED') limited += 1;
      if (primary === 'NOT_ELIGIBLE') {
        notEligible.push(articleIdFromCampaignName(String(c.name ?? '')) || String(c.name ?? ''));
      }
    }
    if (limited > 0) issues.push(`${limited} campaigns budget ki wajah se ruki hui hain`);
    if (notEligible.length > 0) {
      issues.push(`${notEligible.length} campaigns chal nahi rahi (${notEligible.slice(0, 3).join(', ')})`);
    }
  } catch {
    // ignore
  }

  if (enabledCampaigns > 0 && impressions === 0) {
    issues.push(`${days} din se ek bhi ad nahi dikha`);
  } else if (clicks === 0 && impressions > 0) {
    issues.push(`${days} din me ek bhi click nahi aaya`);
  }

  // --- 5. Disapproved ads ----------------------------------------------------
  try {
    const r = (await searchAds(
      customerId,
      'SELECT campaign.name, ad_group_ad.ad.id, ad_group_ad.policy_summary.policy_topic_entries ' +
        "FROM ad_group_ad WHERE ad_group_ad.policy_summary.approval_status = 'DISAPPROVED'",
    )) as {
      results?: Array<{
        campaign?: { name?: string };
        adGroupAd?: { policySummary?: { policyTopicEntries?: Array<{ topic?: string }> } };
      }>;
    };

    const rows = r.results ?? [];
    for (const row of rows) {
      const articleId = articleIdFromCampaignName(String(row.campaign?.name ?? ''));
      const topics = (row.adGroupAd?.policySummary?.policyTopicEntries ?? [])
        .map((t) => readableTopic(String(t.topic ?? '')))
        .filter(Boolean);
      articleIssues.push({
        articleId,
        message: `Ad disapproved${topics.length > 0 ? ` — ${topics.join(', ')}` : ''}`,
      });
    }

    if (rows.length > 0) {
      const names = [...new Set(articleIssues.map((a) => a.articleId).filter(Boolean))];
      issues.push(`${rows.length} ad disapproved (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})`);
    }
  } catch {
    // ignore
  }

  // --- 6. Conversion tracking ------------------------------------------------
  try {
    const r = (await searchAds(
      customerId,
      'SELECT conversion_action.name, conversion_action.status, metrics.all_conversions ' +
        `FROM conversion_action WHERE segments.date DURING LAST_${days}_DAYS`,
    )) as { results?: Array<{ conversionAction?: AdsRow; metrics?: AdsRow }> };

    const active = (r.results ?? []).filter(
      (x) => String(x.conversionAction?.status ?? '') === 'ENABLED',
    );
    if (active.length === 0) {
      issues.push('Koi conversion action chaalu nahi hai');
    } else if (clicks > 0 && conversions === 0) {
      issues.push(`${clicks} clicks aaye par conversion ek bhi nahi — tracking check karo`);
    }
  } catch {
    // ignore
  }

  return { issues, articleIssues, clicks, impressions, conversions };
}
