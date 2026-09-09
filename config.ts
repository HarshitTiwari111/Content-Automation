/**
 * All tunable settings live here.
 * You should never need to edit the files inside src/ to change budget,
 * GEO, bids, keyword count or ad copy limits — change them here.
 */

export const config = {
  // NOTE: campaign/ad group/ad status is NOT configurable on purpose.
  // It is hardcoded to PAUSED inside src/googleads.ts so that no setting,
  // Sheet value or typo can ever create a spending campaign.

  /** Money / bidding -------------------------------------------------------- */
  budget: {
    /** Used when the Sheet row has no Budget value. Account currency, per day. */
    defaultDailyBudget: 300,
    /** Row budget above this is rejected — protects against a typo in the Sheet. */
    maxDailyBudget: 1000,
  },
  /** Default max CPC bid for the ad group (account currency). */
  defaultCpcBid: 15,

  /** Targeting -------------------------------------------------------------- */
  /** Only these GEO codes are allowed in the Sheet's GEO column. */
  allowedGeos: ['US', 'UK', 'GB', 'IN', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL'],
  defaultGeo: 'US',
  /**
   * Google geo target constant ids (country level).
   * Pattern = ISO-3166 numeric code + 2000. Verify new ones against Google's
   * geo target list before adding.
   */
  geoTargetIds: {
    US: 2840,
    UK: 2826,
    GB: 2826,
    IN: 2356,
    CA: 2124,
    AU: 2036,
    DE: 2276,
    FR: 2250,
    ES: 2724,
    IT: 2380,
    NL: 2528,
  } as Record<string, number>,
  /** Google language constant ids. 1000 = English. */
  languageIds: {
    en: 1000,
    de: 1001,
    fr: 1002,
    es: 1003,
    it: 1004,
    nl: 1010,
  } as Record<string, number>,
  defaultLanguage: 'en',

  /** Keywords --------------------------------------------------------------- */
  keywords: {
    /** Max keyword texts generated per article. */
    maxKeywords: 15,
    /** Match types created for every keyword text. */
    matchTypes: ['PHRASE', 'EXACT'] as Array<'EXACT' | 'PHRASE' | 'BROAD'>,
    /** Hard cap on total keyword criteria (texts x match types) per ad group. */
    maxCriteria: 30,
    minWords: 2,
    maxWords: 8,
    /** A keyword containing any of these words is dropped. */
    bannedWords: [
      'free',
      'download',
      'torrent',
      'crack',
      'hack',
      'porn',
      'sex',
      'casino',
      'jobs',
      'salary',
      'pdf',
      'apk',
    ],
    /** Added as negative keywords to every campaign. */
    negatives: [
      'free',
      'download',
      'torrent',
      'crack',
      'jobs',
      'salary',
      'pdf',
      'apk',
      'youtube',
      'wikipedia',
    ],
  },

  /** Responsive Search Ad — Google's hard limits, do not raise. --------------- */
  rsa: {
    headlineMaxChars: 30,
    descriptionMaxChars: 90,
    pathMaxChars: 15,
    minHeadlines: 3,
    maxHeadlines: 15,
    minDescriptions: 2,
    maxDescriptions: 4,
  },

  /** Tracking / naming ------------------------------------------------------ */
  /** {article_id} is replaced with the row's Article ID. */
  utmSuffix: 'utm_source=google&utm_medium=cpc&utm_campaign={article_id}',
  /** SITE | ARTICLE_ID | CHANNEL | GEO | TEMPLATE */
  campaignNamePattern: '{site} | {article_id} | SEARCH | {geo} | {template}',
  defaultTemplate: 'DEFAULT',

  /** Sheet ------------------------------------------------------------------ */
  sheet: {
    /** Row 1 is assumed to be the header row. */
    headerRow: 1,
    /**
     * Column header names as they appear in the Sheet.
     * Left side = internal name, right side = accepted header spellings.
     */
    columns: {
      articleId: ['Article ID', 'ArticleID', 'Article Id'],
      siteId: ['Site ID', 'SiteID', 'Site Id', 'Site'],
      website: ['Website', 'Website URL'],
      brand: ['Brand'],
      category: ['Category'],
      topic: ['Topic/Intent', 'Topic', 'Intent'],
      title: ['Title'],
      liveUrl: ['Live URL', 'URL', 'Live Url'],
      search: ['Search Ads (Y/N)', 'Search (Y/N)', 'Search Ads', 'Search'],
      geo: ['GEO', 'Geo', 'Country'],
      template: ['Template'],
      budget: ['Budget'],
      searchCampaignId: [
        'Search Campaign ID',
        'Search Campaign Id',
        'Search Ads Campaign ID',
        'Search Ad Campaign ID',
      ],
      status: ['Status'],
      notes: ['Error / Notes', 'Error/Notes', 'Notes', 'Error'],
    } as Record<string, string[]>,
  },

  /**
   * AD_ACCOUNT_MAP tab — kaunsi site ki campaign kis Google Ads account me
   * banegi. CONTENT_QUEUE ki row ka Site ID / Website yahan match hota hai
   * aur uske saamne wali Google Ads CID use hoti hai.
   */
  accountMap: {
    tab: 'AD_ACCOUNT_MAP',
    columns: {
      siteId: ['Site ID', 'SiteID', 'Site', 'Website'],
      customerId: ['Google Ads CID', 'Google Ads Cid', 'CID', 'Customer ID', 'Google Ads Account'],
      status: ['Status'],
      // Result columns — inhi me campaign ka record likha jaata hai.
      articleId: ['Article ID', 'ArticleID', 'Article Id'],
      searchCampaignId: ['Search Campaign ID', 'Search Campaign Id', 'Campaign ID'],
      notes: ['Error / Notes', 'Error/Notes', 'Notes', 'Error'],
    } as Record<string, string[]>,
  },

  /** Validation ------------------------------------------------------------- */
  validation: {
    /** Live URL must answer within this time. */
    urlTimeoutMs: 10_000,
    /** Check that the Live URL host matches the Website column. */
    matchUrlToWebsite: true,
  },

  /** How many rows one run may process. Safety brake. */
  maxRowsPerRun: 20,
} as const;

export type AppConfig = typeof config;
