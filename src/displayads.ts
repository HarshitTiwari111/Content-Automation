import { config } from '../config.js';
import { env } from './env.js';
import { mutateResource, PartialCampaignError, uploadImageAsset } from './googleads.js';
import { buildDisplayImages } from './images.js';
import { logger } from './logger.js';
import type { CampaignResult, DisplayPlan } from './types.js';

/**
 * Google Display campaign (PDF section 9 / Phase 4).
 *
 * Search jaisa hi flow hai, teen farak ke saath:
 *   - advertisingChannelType DISPLAY hota hai
 *   - keywords nahi lagte
 *   - ad ke liye do images chahiye (1.91:1 aur 1:1), jo pehle asset banti hain
 *
 * Search ki tarah yahan bhi campaign, ad group aur ad — teeno PAUSED hi bante
 * hain. Ye rule badla nahi ja sakta.
 */

/** 1 unit = 1,000,000 micros. */
function toMicros(amount: number): string {
  return String(Math.round(amount * 1_000_000));
}

function idFromResourceName(resourceName: string): string {
  return resourceName.split('/').pop() ?? '';
}

export async function createDisplayCampaign(plan: DisplayPlan): Promise<CampaignResult> {
  if (env.dryRun) {
    logger.step('🧪 DRY RUN — Google Ads ko kuch nahi bheja gaya');
    return {
      campaignId: `DRY-${plan.row.articleId}`,
      campaignResourceName: 'dry-run',
      adGroupId: `DRY-AG-${plan.row.articleId}`,
      keywordCount: 0,
      dryRun: true,
    };
  }

  // 1. Images pehle — ye sabse zyada fail hone wala step hai, isliye campaign
  //    banane se pehle kar lete hain. Fail hua to kuch bana hi nahi hoga.
  const images = await buildDisplayImages(plan.imageUrl);
  logger.step('🖼️  Image download aur crop ho gayi (1.91:1 + 1:1)');

  const marketingAsset = await uploadImageAsset(
    plan.customerId,
    images.marketing,
    `${plan.row.articleId} marketing ${Date.now()}`,
  );
  const squareAsset = await uploadImageAsset(
    plan.customerId,
    images.square,
    `${plan.row.articleId} square ${Date.now()}`,
  );
  logger.step('🖼️  Dono images Google Ads me upload ho gayin');

  // 2. Daily budget.
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

  // 3. Campaign — PAUSED, Display network.
  const campaignResourceName = await mutateResource(
    plan.customerId,
    'campaigns',
    [
      {
        create: {
          name: plan.campaignName,
          // Hard rule: campaign kabhi enabled nahi banegi.
          status: 'PAUSED',
          advertisingChannelType: 'DISPLAY',
          campaignBudget: budgetResourceName,
          manualCpc: { enhancedCpcEnabled: false },
          finalUrlSuffix: plan.finalUrlSuffix,
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        },
      },
    ],
    'Campaign',
  );
  const campaignId = idFromResourceName(campaignResourceName);
  logger.step(`🎯 Display campaign bani (PAUSED) → ID ${campaignId}`);

  try {
    // 4. GEO + language.
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
      ],
      'GEO/language',
    );
    logger.step(`🌍 GEO ${plan.geo} set`);

    // 5. Ad group — ye bhi PAUSED.
    const adGroupResourceName = await mutateResource(
      plan.customerId,
      'adGroups',
      [
        {
          create: {
            name: `${plan.campaignName} | AG1`,
            campaign: campaignResourceName,
            status: 'PAUSED',
            type: 'DISPLAY_STANDARD',
            cpcBidMicros: toMicros(plan.cpcBid),
          },
        },
      ],
      'Ad group',
    );
    const adGroupId = idFromResourceName(adGroupResourceName);
    logger.step('📁 Ad group bana (PAUSED)');

    // 6. Responsive Display Ad.
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
              responsiveDisplayAd: {
                marketingImages: [{ asset: marketingAsset }],
                squareMarketingImages: [{ asset: squareAsset }],
                headlines: plan.adCopy.headlines.map((text) => ({ text })),
                longHeadline: { text: plan.adCopy.longHeadline },
                descriptions: plan.adCopy.descriptions.map((text) => ({ text })),
                businessName: plan.adCopy.businessName,
              },
            },
          },
        },
      ],
      'Responsive Display Ad',
    );
    logger.step('📝 Responsive Display Ad bana');

    return {
      campaignId,
      campaignResourceName,
      adGroupId,
      keywordCount: 0,
      dryRun: false,
    };
  } catch (error) {
    throw new PartialCampaignError(
      error instanceof Error ? error.message : String(error),
      campaignId,
    );
  }
}
