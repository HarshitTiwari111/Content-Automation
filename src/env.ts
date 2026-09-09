import 'dotenv/config';

/**
 * JSON file se copy-paste karte waqt aksar aage-peeche quotes aur aakhir me
 * comma reh jaata hai. Unhe yahin saaf kar dete hain.
 */
function read(name: string): string {
  return (process.env[name] ?? '')
    .trim()
    .replace(/,$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

const args = process.argv.slice(2);

/** CLI flags: --dry, --live, --limit=5, --article=A0182 */
export const cli = {
  dry: args.includes('--dry'),
  live: args.includes('--live'),
  limit: (() => {
    const raw = args.find((a) => a.startsWith('--limit='));
    const n = raw ? Number(raw.split('=')[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })(),
  article: args.find((a) => a.startsWith('--article='))?.split('=')[1],
};

/**
 * .env me private key ek hi line me hoti hai jisme "\n" likha hota hai.
 * Node ko asli newline chahiye, isliye yahan badal dete hain.
 * Aage-peeche lage quotes bhi hata dete hain.
 */
function readPrivateKey(name: string): string {
  return read(name)
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
    .trim();
}

export const env = {
  /** SPREADSHEET_ID pehle, SHEET_ID purana naam hai (dono chalenge). */
  sheetId: read('SPREADSHEET_ID') || read('SHEET_ID'),
  sheetTab: read('SHEET_TAB') || 'CONTENT_QUEUE',

  /** Tarika 1 — chaabi seedhe .env me (recommended). */
  sheetClientEmail: read('GOOGLE_CLIENT_EMAIL'),
  sheetPrivateKey: readPrivateKey('GOOGLE_PRIVATE_KEY'),

  /** Tarika 2 — chaabi ek JSON file me (fallback, agar upar wale khaali hon). */
  serviceAccountKeyFile: read('GOOGLE_SERVICE_ACCOUNT_KEY_FILE') || './service-account.json',

  /**
   * Google Ads proxy ke through chalta hai — client id / secret / developer
   * token yahan nahi chahiye, wo sab proxy handle karti hai.
   */
  ads: {
    proxyBaseUrl: (read('ADS_PROXY_BASE_URL') || 'https://secure.dataram.workers.dev/api').replace(
      /\/+$/,
      '',
    ),
    apiVersion: read('ADS_API_VERSION') || 'v24',
    refreshToken: read('GOOGLE_ADS_REFRESH_TOKEN'),
    customerId: digitsOnly(read('GOOGLE_ADS_CUSTOMER_ID')),
    loginCustomerId: digitsOnly(read('GOOGLE_ADS_LOGIN_CUSTOMER_ID')),
    timeoutMs: 30_000,
  },

  /**
   * Dry run is ON unless it is explicitly turned off.
   * --dry always wins, --live turns it off from the command line.
   */
  dryRun: cli.dry ? true : cli.live ? false : read('DRY_RUN').toLowerCase() !== 'false',
};

/** Throws with a readable message if something required is missing. */
export function assertSheetEnv(): void {
  if (!env.sheetId) {
    throw new Error('.env me SPREADSHEET_ID missing hai.');
  }

  const hasInlineKey = env.sheetClientEmail !== '' && env.sheetPrivateKey !== '';
  if (hasInlineKey) {
    if (!env.sheetPrivateKey.includes('BEGIN PRIVATE KEY')) {
      throw new Error(
        'GOOGLE_PRIVATE_KEY adhoori lag rahi hai — poori key copy karo, ' +
          '"-----BEGIN PRIVATE KEY-----" se "-----END PRIVATE KEY-----" tak.',
      );
    }
    return;
  }

  if (env.sheetClientEmail && !env.sheetPrivateKey) {
    throw new Error('.env me GOOGLE_PRIVATE_KEY missing hai.');
  }
  if (!env.sheetClientEmail && env.sheetPrivateKey) {
    throw new Error('.env me GOOGLE_CLIENT_EMAIL missing hai.');
  }
  // Dono khaali hain — sheet.ts JSON key file try karega aur wahan se error dega.
}

/** Only needed when we actually talk to Google Ads (not in dry run). */
export function assertAdsEnv(): void {
  const missing: string[] = [];
  if (!env.ads.refreshToken) missing.push('GOOGLE_ADS_REFRESH_TOKEN');
  if (!env.ads.customerId) missing.push('GOOGLE_ADS_CUSTOMER_ID');
  if (missing.length > 0) {
    throw new Error(
      `Google Ads ke liye ye values missing hain: ${missing.join(', ')}. ` +
        'Ya to .env bharo, ya DRY_RUN=true rakh ke chalao.',
    );
  }
}
