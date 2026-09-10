import { assertAdsEnv, env } from './env.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import type { CampaignPlan, CampaignResult } from './types.js';

/**
 * Google Ads REST API, proxy ke through.
 *
 * Proxy transparent hai: Google ke official REST path ke aage bas proxy ka
 * base URL lag jaata hai. Auth proxy khud handle karti hai — hume sirf
 * refresh token header me bhejna hai.
 *
 *   POST {BASE}/{version}/customers/{customerId}/{resource}:mutate
 */

/** 1 unit of currency = 1,000,000 micros. int64 isliye string me bhejte hain. */
function toMicros(amount: number): string {
  return String(Math.round(amount * 1_000_000));
}


/** "customers/123/campaigns/456" -> "456" */
function idFromResourceName(resourceName: string): string {
  return resourceName.split('/').pop() ?? '';
}

interface MutateResult {
  resourceName?: string;
}

interface MutateResponse {
  results?: MutateResult[];
}

/**
 * Campaign ban gayi thi lekin uske baad ka koi step fail ho gaya.
 * Campaign id saath me le kar jaati hai taaki Sheet me likhi ja sake —
 * warna agli run dobara wahi campaign bana degi (duplicate).
 */
export class PartialCampaignError extends Error {
  constructor(
    message: string,
    readonly campaignId: string,
  ) {
    super(message);
    this.name = 'PartialCampaignError';
  }
}

/**
 * Node ka "fetch failed" kuch nahi batata — asli wajah `cause` me chhupi hoti
 * hai (ENOTFOUND, ECONNREFUSED, certificate error, timeout...). Wahi nikalta hai.
 */
export function networkErrorDetail(error: unknown): string {
  const err = error as { message?: string; cause?: { message?: string; code?: string } };
  const parts = [err?.message ?? String(error)];
  if (err?.cause?.code) parts.push(err.cause.code);
  if (err?.cause?.message && err.cause.message !== err.message) parts.push(err.cause.message);
  return parts.filter(Boolean).join(' — ');
}

interface GoogleAdsError {
  message?: string;
  errorCode?: Record<string, string>;
  trigger?: { stringValue?: string };
  location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> };
}

/**
 * Google Ads REST error body se padhne layak message nikalta hai.
 * "The required field was not present." jaisa message akela bekaar hai —
 * isliye field ka path aur error code bhi saath me dikhate hain.
 */
function extractApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; details?: Array<{ errors?: GoogleAdsError[] }> };
    };

    const detailed = (parsed.error?.details ?? [])
      .flatMap((detail) => detail.errors ?? [])
      .map((e) => {
        const parts: string[] = [e.message ?? ''];

        const path = (e.location?.fieldPathElements ?? [])
          .map((el) => el.fieldName)
          .filter(Boolean)
          .join('.');
        if (path) parts.push(`field: ${path}`);

        const code = Object.values(e.errorCode ?? {}).join(',');
        if (code) parts.push(`code: ${code}`);

        return parts.filter(Boolean).join(' — ');
      })
      .filter(Boolean);

    if (detailed.length > 0) return detailed.join(' | ');
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // JSON nahi tha — neeche raw body hi bhej dete hain.
  }
  return `HTTP ${status}: ${body.slice(0, 300)}`;
}

/** Proxy ko bhejne wale headers. */
function adsHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'x-user-refresh-token': env.ads.refreshToken,
    'Content-Type': 'application/json',
  };
  if (env.ads.loginCustomerId) {
    headers['login-customer-id'] = env.ads.loginCustomerId;
  }
  return headers;
}

/**
 * Read-only query (GAQL). Kuch banata nahi, sirf poochta hai —
 * connection test karne ke liye safe hai.
 */
export async function searchAds(customerId: string, query: string): Promise<unknown> {
  assertAdsEnv();

  const url = `${env.ads.proxyBaseUrl}/${env.ads.apiVersion}/customers/${customerId}/googleAds:search`;
  const headers = adsHeaders();

  const response = await withRetry('Ads search', () =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(env.ads.timeoutMs),
    }),
  ).catch((error: unknown) => {
    throw new Error(`Request nahi pahunchi (${url}): ${networkErrorDetail(error)}`);
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractApiError(response.status, text));
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Proxy ne JSON nahi bheja: ${text.slice(0, 200)}`);
  }
}

/** Ek mutate call. Resource name wapas karta hai. */
export async function mutateResource(
  customerId: string,
  resource: string,
  operations: unknown[],
  what: string,
): Promise<string> {
  const url = `${env.ads.proxyBaseUrl}/${env.ads.apiVersion}/customers/${customerId}/${resource}:mutate`;
  const headers = adsHeaders();

  const response = await withRetry(what, () =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ operations }),
      signal: AbortSignal.timeout(env.ads.timeoutMs),
    }),
  ).catch((error: unknown) => {
    throw new Error(`${what} — request nahi pahunchi: ${networkErrorDetail(error)}`);
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = extractApiError(response.status, text);

    // Ye error aksar tab aata hai jab pichli adhoori campaign Google Ads me
    // padi ho — naam wahi hai, isliye nayi ban hi nahi sakti.
    if (detail.includes('DUPLICATE_CAMPAIGN_NAME')) {
      detail +=
        ' → Google Ads me isi naam ki campaign pehle se hai (shayad pichli adhoori run se). ' +
        'Use Remove karo, phir dobara chalao.';
    }

    throw new Error(`${what} fail — ${detail}`);
  }

  let parsed: MutateResponse;
  try {
    parsed = JSON.parse(text) as MutateResponse;
  } catch {
    throw new Error(`${what} — proxy ne JSON nahi bheja: ${text.slice(0, 200)}`);
  }

  const resourceName = parsed.results?.[0]?.resourceName;
  if (!resourceName) {
    throw new Error(`${what} — response me resourceName nahi mila.`);
  }
  return resourceName;
}

/**
 * Image ko Google Ads me asset banake uska resource name laata hai.
 * Responsive Display Ad me image seedhe nahi ja sakti — pehle asset banti hai.
 */
export async function uploadImageAsset(
  customerId: string,
  base64Image: string,
  name: string,
): Promise<string> {
  return mutateResource(
    customerId,
    'assets',
    [
      {
        create: {
          name,
          type: 'IMAGE',
          imageAsset: { data: base64Image },
        },
      },
    ],
    `Image asset (${name})`,
  );
}

/**
 * Creates the whole Search campaign, always PAUSED:
 *   budget -> campaign -> geo/language/negatives -> ad group -> keywords -> RSA
 * In dry-run mode nothing is sent; fake ids are returned instead.
 */
export async function createSearchCampaign(plan: CampaignPlan): Promise<CampaignResult> {
  if (env.dryRun) {
    logger.step('🧪 DRY RUN — Google Ads ko kuch nahi bheja gaya');
    return {
      campaignId: `DRY-${plan.row.articleId}`,
      campaignResourceName: 'dry-run',
      adGroupId: `DRY-AG-${plan.row.articleId}`,
      keywordCount: plan.keywords.length,
      dryRun: true,
    };
  }

  assertAdsEnv();

  // 1. Daily budget (kisi aur campaign ke saath share nahi).
  const budgetResourceName = await mutateResource(
    plan.customerId,
    'campaignBudgets',
    [
      {
        create: {
          name: `${plan.campaignName} | BUDGET`,
          amountMicros: toMicros(plan.dailyBudget),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    ],
    'Budget',
  );
  logger.step(`💰 Budget bana (${plan.dailyBudget}/day)`);

  // 2. Campaign — PAUSED, sirf Google Search network.
  const campaignResourceName = await mutateResource(
    plan.customerId,
    'campaigns',
    [
      {
        create: {
          name: plan.campaignName,
          // Hard rule: campaign kabhi enabled nahi banegi.
          status: 'PAUSED',
          advertisingChannelType: 'SEARCH',
          campaignBudget: budgetResourceName,
          manualCpc: { enhancedCpcEnabled: false },
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: false,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
          // startDate jaanbujh ke nahi bhej rahe — is API version me wo field
          // nahi hai, aur na dene par Google aaj ki date khud laga deta hai.
          finalUrlSuffix: plan.finalUrlSuffix,
          // Google ab har campaign pe ye declaration maangta hai.
          // Ye content articles hain, EU political advertising nahi —
          // agar kabhi political ads chalayein to ye badalna ZAROORI hai.
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        },
      },
    ],
    'Campaign',
  );
  const campaignId = idFromResourceName(campaignResourceName);
  logger.step(`🎯 Campaign bani (PAUSED) → ID ${campaignId}`);

  // Yahan se aage kuch bhi fail ho to campaign id saath me bhejni hai,
  // warna Sheet khaali reh jayegi aur agli run duplicate bana degi.
  try {
    // 3. GEO + language + campaign level negative keywords.
    await mutateResource(
      plan.customerId,
      'campaignCriteria',
      [
        {
          create: {
            campaign: campaignResourceName,
            location: { geoTargetConstant: `geoTargetConstants/${plan.geoTargetId}` },
          },
        },
        {
          create: {
            campaign: campaignResourceName,
            language: { languageConstant: `languageConstants/${plan.languageId}` },
          },
        },
        ...plan.negatives.map((text) => ({
          create: {
            campaign: campaignResourceName,
            negative: true,
            keyword: { text, matchType: 'BROAD' },
          },
        })),
      ],
      'GEO/language/negatives',
    );
    logger.step(`🌍 GEO ${plan.geo} + ${plan.negatives.length} negative keywords set`);

    // 4. Ad group — ye bhi PAUSED.
    const adGroupResourceName = await mutateResource(
      plan.customerId,
      'adGroups',
      [
        {
          create: {
            name: `${plan.campaignName} | AG1`,
            campaign: campaignResourceName,
            status: 'PAUSED',
            type: 'SEARCH_STANDARD',
            cpcBidMicros: toMicros(plan.cpcBid),
          },
        },
      ],
      'Ad group',
    );
    const adGroupId = idFromResourceName(adGroupResourceName);
    logger.step('📁 Ad group bana (PAUSED)');

    // 5. Keywords.
    await mutateResource(
      plan.customerId,
      'adGroupCriteria',
      plan.keywords.map((keyword) => ({
        create: {
          adGroup: adGroupResourceName,
          status: 'ENABLED',
          keyword: { text: keyword.text, matchType: keyword.matchType },
        },
      })),
      'Keywords',
    );
    logger.step(`🔑 ${plan.keywords.length} keywords add hue`);

    // 6. Responsive Search Ad.
    await mutateResource(
      plan.customerId,
      'adGroupAds',
      [
        {
          create: {
            adGroup: adGroupResourceName,
            status: 'PAUSED',
            ad: {
              finalUrls: [plan.finalUrl],
              responsiveSearchAd: {
                headlines: plan.adCopy.headlines.map((text) => ({ text })),
                descriptions: plan.adCopy.descriptions.map((text) => ({ text })),
                ...(plan.adCopy.path1 ? { path1: plan.adCopy.path1 } : {}),
                ...(plan.adCopy.path2 ? { path2: plan.adCopy.path2 } : {}),
              },
            },
          },
        },
      ],
      'Responsive Search Ad',
    );
    logger.step('📝 Responsive Search Ad bana');

    return {
      campaignId,
      campaignResourceName,
      adGroupId,
      keywordCount: plan.keywords.length,
      dryRun: false,
    };
  } catch (error) {
    throw new PartialCampaignError(describeAdsError(error), campaignId);
  }
}

/** Error ko padhne layak text me badalta hai. */
export function describeAdsError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
