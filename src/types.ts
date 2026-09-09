/** One article row read from the Google Sheet. */
export interface ArticleRow {
  /** 1-based row number in the Sheet (needed to write the result back). */
  rowNumber: number;
  articleId: string;
  /** AD_ACCOUNT_MAP me isi se Google Ads CID dhoondhi jaati hai. */
  siteId: string;
  website: string;
  brand: string;
  category: string;
  topic: string;
  title: string;
  liveUrl: string;
  search: string;
  geo: string;
  template: string;
  budget: string;
  searchCampaignId: string;
  status: string;
  notes: string;
}

/** Keyword criterion to create in the ad group. */
export interface KeywordCriterion {
  text: string;
  matchType: 'EXACT' | 'PHRASE' | 'BROAD';
}

/** Generated Responsive Search Ad copy. */
export interface AdCopy {
  headlines: string[];
  descriptions: string[];
  path1: string;
  path2: string;
}

/** Everything the Google Ads layer needs to build one campaign. */
export interface CampaignPlan {
  row: ArticleRow;
  /** Google Ads account jisme campaign banegi (AD_ACCOUNT_MAP se). */
  customerId: string;
  campaignName: string;
  dailyBudget: number;
  cpcBid: number;
  geo: string;
  geoTargetId: number;
  languageId: number;
  finalUrl: string;
  finalUrlSuffix: string;
  keywords: KeywordCriterion[];
  negatives: string[];
  adCopy: AdCopy;
}

/** Ids returned after the campaign is created. */
export interface CampaignResult {
  campaignId: string;
  campaignResourceName: string;
  adGroupId: string;
  keywordCount: number;
  dryRun: boolean;
}

/** Per-row outcome for the final summary. */
export interface RowOutcome {
  articleId: string;
  ok: boolean;
  campaignId?: string;
  reason?: string;
}
