import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { google, type sheets_v4 } from 'googleapis';
import { config } from '../config.js';
import { env } from './env.js';
import { withRetry } from './retry.js';
import type { ArticleRow, CampaignTemplate } from './types.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const READ_RANGE_END = 'BZ';

let client: sheets_v4.Sheets | null = null;
let headers: string[] = [];

interface ServiceAccountKey {
  client_email?: string;
  private_key?: string;
}

/**
 * Credentials do jagah se aa sakti hain:
 *   1. .env me GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY  (pehli pasand)
 *   2. service-account.json file                          (fallback)
 */
function loadCredentials(): { email: string; key: string } {
  if (env.sheetClientEmail && env.sheetPrivateKey) {
    return { email: env.sheetClientEmail, key: env.sheetPrivateKey };
  }

  const keyPath = resolve(process.cwd(), env.serviceAccountKeyFile);
  if (!existsSync(keyPath)) {
    throw new Error(
      '.env me GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY nahi mile, ' +
        `aur service account file bhi nahi mili: ${keyPath}`,
    );
  }

  let key: ServiceAccountKey;
  try {
    key = JSON.parse(readFileSync(keyPath, 'utf8')) as ServiceAccountKey;
  } catch {
    throw new Error(`Service account file valid JSON nahi hai: ${keyPath}`);
  }

  if (!key.client_email || !key.private_key) {
    throw new Error('Service account JSON me client_email ya private_key missing hai.');
  }

  return { email: key.client_email, key: key.private_key };
}

function getClient(): sheets_v4.Sheets {
  if (client) return client;

  const { email, key } = loadCredentials();

  const auth = new google.auth.JWT({ email, key, scopes: SCOPES });

  client = google.sheets({ version: 'v4', auth });
  return client;
}

/** 0-based column index -> A1 letter (0 -> A, 26 -> AA). */
function columnLetter(index: number): string {
  let n = index;
  let letter = '';
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Finds the column index for an internal field name using the aliases in config. */
function columnIndex(field: string): number {
  const aliases = config.sheet.columns[field] ?? [];
  for (const alias of aliases) {
    const found = headers.findIndex((h) => normalise(h) === normalise(alias));
    if (found !== -1) return found;
  }
  return -1;
}

function cell(row: string[], field: string): string {
  const index = columnIndex(field);
  if (index === -1) return '';
  return (row[index] ?? '').toString().trim();
}

/** Turns Google's cryptic errors into something readable. */
function explainSheetError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('DECODER') || message.includes('PEM') || message.includes('asn1')) {
    return new Error(
      'GOOGLE_PRIVATE_KEY sahi nahi hai. Poori key ek line me, double quotes ke andar, ' +
        'aur \\n waise ke waise rakho.',
    );
  }
  if (message.includes('403') || message.toLowerCase().includes('permission')) {
    return new Error(
      'Sheet tak pahunch nahi mili. Sheet ko GOOGLE_CLIENT_EMAIL wale email ke saath ' +
        'Share karke Editor access do.',
    );
  }
  if (message.includes('404') || message.toLowerCase().includes('not found')) {
    return new Error('SPREADSHEET_ID galat lag raha hai — Sheet mili hi nahi.');
  }
  if (message.toLowerCase().includes('unable to parse range')) {
    return new Error(`Tab ka naam galat hai: "${env.sheetTab}" — Sheet me aisa tab nahi hai.`);
  }
  if (message.includes('invalid_grant') || message.includes('invalid_client')) {
    return new Error('Service account credentials reject ho gaye — email/key dobara check karo.');
  }
  return error instanceof Error ? error : new Error(message);
}

/** Reads every data row from the configured tab. */
export async function readRows(): Promise<ArticleRow[]> {
  const sheets = getClient();
  const range = `${env.sheetTab}!A${config.sheet.headerRow}:${READ_RANGE_END}`;

  const response = await withRetry(`${env.sheetTab} padhna`, () =>
    sheets.spreadsheets.values.get({
      spreadsheetId: env.sheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  ).catch((error: unknown) => {
    throw explainSheetError(error);
  });

  const values = (response.data.values ?? []) as string[][];
  if (values.length === 0) {
    throw new Error(`Sheet tab "${env.sheetTab}" khaali hai ya mila hi nahi.`);
  }

  headers = (values[0] ?? []).map((h) => (h ?? '').toString());

  const required = ['articleId', 'liveUrl', 'search'];
  const missing = required.filter((field) => columnIndex(field) === -1);
  if (missing.length > 0) {
    const names = missing.map((f) => (config.sheet.columns[f] ?? [f])[0]).join(', ');
    throw new Error(`Sheet me ye columns nahi mile: ${names}`);
  }

  const rows: ArticleRow[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const raw = (values[i] ?? []) as string[];
    const articleId = cell(raw, 'articleId');
    if (!articleId) continue;

    rows.push({
      rowNumber: config.sheet.headerRow + i,
      articleId,
      siteId: cell(raw, 'siteId'),
      website: cell(raw, 'website'),
      brand: cell(raw, 'brand'),
      category: cell(raw, 'category'),
      topic: cell(raw, 'topic'),
      title: cell(raw, 'title'),
      liveUrl: cell(raw, 'liveUrl'),
      search: cell(raw, 'search'),
      geo: cell(raw, 'geo'),
      template: cell(raw, 'template'),
      budget: cell(raw, 'budget'),
      searchCampaignId: cell(raw, 'searchCampaignId'),
      status: cell(raw, 'status'),
      notes: cell(raw, 'notes'),
    });
  }

  return rows;
}

/**
 * Rows that still need a Search campaign:
 *   Search = YES  AND  Live URL present  AND  campaign pehle se nahi bani.
 * "Pehle se bani" AD_ACCOUNT_MAP ke record se pata chalta hai — yahi
 * duplicate campaigns rokta hai.
 */
export function selectEligible(
  rows: ArticleRow[],
  createdCampaigns: Map<string, string>,
): ArticleRow[] {
  return rows.filter((row) => {
    const wantsSearch = ['yes', 'y', 'true'].includes(row.search.toLowerCase());
    const alreadyDone = createdCampaigns.has(row.articleId) || row.searchCampaignId !== '';
    return wantsSearch && !alreadyDone && row.liveUrl !== '';
  });
}

/**
 * Site ka naam match karne ke liye ek saaf key banata hai.
 * "https://www.Site1.com/blog" aur "site1.com" dono "site1.com" ban jate hain.
 */
export function siteKey(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
  return (cleaned.split('/')[0] ?? '').trim();
}

/**
 * Sheet me date wahi shakl me jaani chahiye jo baaki rows me hai:
 * "10/09/2026 10:44:05" — India time, ISO/UTC nahi.
 */
function sheetTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * USER_ENTERED me "=" ya "+" se shuru hone wala text formula ban jaata hai.
 * Error message aisa ho sakta hai, isliye aage ek space laga dete hain.
 */
function safeCell(value: string): string {
  return /^[=+\-@]/.test(value) ? ` ${value}` : value;
}

function toNumber(value: string): number | undefined {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * CAMPAIGN_TEMPLATES tab: Template Name -> uske rules.
 * Budget cap, max bid aur allowed GEO yahin se aate hain — config sirf
 * fallback hai jab template na mile.
 */
export async function readCampaignTemplates(): Promise<Map<string, CampaignTemplate>> {
  const sheets = getClient();
  const map = new Map<string, CampaignTemplate>();

  let values: string[][] = [];
  try {
    const response = await withRetry(`${config.campaignTemplates.tab} padhna`, () =>
      sheets.spreadsheets.values.get({
        spreadsheetId: env.sheetId,
        range: `${config.campaignTemplates.tab}!A1:Z`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      }),
    );
    values = (response.data.values ?? []) as string[][];
  } catch {
    return map; // Tab nahi hai — config ke defaults chalenge.
  }

  if (values.length < 2) return map;

  const tplHeaders = (values[0] ?? []).map((h) => (h ?? '').toString());
  const at = (field: string): number => {
    const aliases = config.campaignTemplates.columns[field] ?? [];
    return tplHeaders.findIndex((header) => aliases.some((a) => normalise(a) === normalise(header)));
  };
  const cellOf = (row: string[], field: string): string => {
    const i = at(field);
    return i === -1 ? '' : (row[i] ?? '').toString().trim();
  };

  for (let i = 1; i < values.length; i += 1) {
    const raw = (values[i] ?? []) as string[];
    const name = cellOf(raw, 'name');
    if (!name) continue;

    map.set(normalise(name), {
      name,
      allowedGeos: cellOf(raw, 'allowedGeos')
        .split(/[,/|]/)
        .map((g) => g.trim().toUpperCase())
        .filter(Boolean),
      device: cellOf(raw, 'device'),
      dailyBudgetCap: toNumber(cellOf(raw, 'dailyBudgetCap')),
      maxBid: toNumber(cellOf(raw, 'maxBid')),
      defaultStatus: cellOf(raw, 'defaultStatus'),
    });
  }

  return map;
}

/**
 * WEBSITE_CONFIG tab: domain -> Site ID (SITE-1, SITE-4...).
 * Campaign ke naam me site ka chhota code aata hai, poora domain nahi.
 */
export async function readSiteIds(): Promise<Map<string, string>> {
  const sheets = getClient();
  const map = new Map<string, string>();

  let values: string[][] = [];
  try {
    const response = await withRetry(`${config.websiteConfig.tab} padhna`, () =>
      sheets.spreadsheets.values.get({
        spreadsheetId: env.sheetId,
        range: `${config.websiteConfig.tab}!A1:Z`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      }),
    );
    values = (response.data.values ?? []) as string[][];
  } catch {
    return map; // Tab nahi hai — koi baat nahi, domain se hi kaam chal jayega.
  }

  if (values.length < 2) return map;

  const configHeaders = (values[0] ?? []).map((h) => (h ?? '').toString());
  const findColumn = (aliases: string[]): number =>
    configHeaders.findIndex((header) => aliases.some((a) => normalise(a) === normalise(header)));

  const siteIdIndex = findColumn(config.websiteConfig.columns.siteId ?? []);
  const domainIndex = findColumn(config.websiteConfig.columns.domain ?? []);
  if (siteIdIndex === -1 || domainIndex === -1) return map;

  for (let i = 1; i < values.length; i += 1) {
    const raw = (values[i] ?? []) as string[];
    const domain = siteKey((raw[domainIndex] ?? '').toString());
    const siteId = (raw[siteIdIndex] ?? '').toString().trim();
    if (domain && siteId) map.set(domain, siteId);
  }

  return map;
}

/** AD_ACCOUNT_MAP tab ka kaccha data + column dhoondhne ka helper. */
interface AccountMapData {
  headers: string[];
  rows: string[][];
  index: (field: string) => number;
  cell: (row: string[], field: string) => string;
}

async function readAccountMapTab(): Promise<AccountMapData | null> {
  const sheets = getClient();

  let values: string[][] = [];
  try {
    const response = await withRetry(`${config.accountMap.tab} padhna`, () =>
      sheets.spreadsheets.values.get({
        spreadsheetId: env.sheetId,
        range: `${config.accountMap.tab}!A1:Z`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      }),
    );
    values = (response.data.values ?? []) as string[][];
  } catch {
    return null; // Tab exist hi nahi karta.
  }

  if (values.length === 0) return null;

  const mapHeaders = (values[0] ?? []).map((h) => (h ?? '').toString());
  const index = (field: string): number => {
    const aliases = config.accountMap.columns[field] ?? [];
    return mapHeaders.findIndex((header) =>
      aliases.some((alias) => normalise(alias) === normalise(header)),
    );
  };
  const cellOf = (row: string[], field: string): string => {
    const i = index(field);
    return i === -1 ? '' : (row[i] ?? '').toString().trim();
  };

  return { headers: mapHeaders, rows: values.slice(1), index, cell: cellOf };
}

/**
 * Site ID -> Google Ads CID.
 * Sirf mapping rows se banta hai — jin rows me Article ID bhara hai wo
 * campaign ka record hain, mapping nahi.
 */
export async function readAccountMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const data = await readAccountMapTab();
  if (!data) return map;

  for (const row of data.rows) {
    if (data.cell(row, 'articleId')) continue; // result row hai, mapping nahi
    const key = siteKey(data.cell(row, 'siteId'));
    const customerId = data.cell(row, 'customerId').replace(/[^0-9]/g, '');
    if (key && customerId) map.set(key, customerId);
  }

  return map;
}

/**
 * Jin articles ki campaign pehle se ban chuki hai — Article ID -> Campaign ID.
 * Yahi duplicate campaigns rokta hai.
 */
export async function readCreatedCampaigns(): Promise<Map<string, string>> {
  const created = new Map<string, string>();
  const data = await readAccountMapTab();
  if (!data) return created;

  for (const row of data.rows) {
    const articleId = data.cell(row, 'articleId');
    const campaignId = data.cell(row, 'searchCampaignId');
    if (articleId && campaignId) created.set(articleId, campaignId);
  }

  return created;
}

/** CONTENT_QUEUE me ye column maujood hai ya nahi (readRows ke baad hi sahi jawab dega). */
export function hasColumn(field: string): boolean {
  return columnIndex(field) !== -1;
}

/**
 * Live chalane se PEHLE check karta hai ki CONTENT_QUEUE me campaign ID
 * likhne ki jagah hai ya nahi. Warna campaign ban jayegi aur uska ID kahin
 * likha nahi jayega — agli run duplicate bana degi.
 */
export function assertContentQueueWritable(): void {
  if (columnIndex('searchCampaignId') === -1) {
    const name = (config.sheet.columns.searchCampaignId ?? ['Search Campaign ID'])[0];
    throw new Error(
      `${env.sheetTab} ki row 1 me "${name}" column add karo. ` +
        'Iske bina campaign ka ID likha nahi ja sakta (aur duplicate ban sakti hai).',
    );
  }
}

/**
 * ERROR_LOG tab me ek row jodta hai. Tab ya columns na hon to chup-chaap
 * chhod deta hai — error likhne ki koshish me asli kaam nahi rukna chahiye.
 */
export async function appendErrorLog(entry: {
  articleId: string;
  message: string;
  retryStatus: string;
}): Promise<boolean> {
  const sheets = getClient();

  let logHeaders: string[] = [];
  try {
    const response = await withRetry(`${config.errorLog.tab} padhna`, () =>
      sheets.spreadsheets.values.get({
        spreadsheetId: env.sheetId,
        range: `${config.errorLog.tab}!A1:Z1`,
      }),
    );
    logHeaders = (response.data.values?.[0] ?? []).map((h) => (h ?? '').toString());
  } catch {
    return false; // Tab hi nahi hai.
  }

  if (logHeaders.length === 0) return false;

  const at = (field: string): number => {
    const aliases = config.errorLog.columns[field] ?? [];
    return logHeaders.findIndex((header) => aliases.some((a) => normalise(a) === normalise(header)));
  };

  const values: string[] = new Array(logHeaders.length).fill('');
  const put = (field: string, value: string): void => {
    const i = at(field);
    if (i !== -1) values[i] = value;
  };
  put('timestamp', sheetTimestamp());
  put('articleId', entry.articleId);
  put('component', config.errorLog.component);
  put('message', safeCell(entry.message));
  put('retryStatus', entry.retryStatus);

  await withRetry(`${config.errorLog.tab} me likhna`, () =>
    sheets.spreadsheets.values.append({
      spreadsheetId: env.sheetId,
      range: `${config.errorLog.tab}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    }),
  );

  return true;
}

/**
 * Live chalane se PEHLE check karta hai ki record likha ja sakega ya nahi.
 * Warna campaign ban jayegi lekin uska ID kahin likha nahi jayega — aur
 * agli run wahi campaign dobara bana degi.
 */
export async function assertAccountMapWritable(): Promise<void> {
  const data = await readAccountMapTab();
  if (!data) {
    throw new Error(
      `${config.accountMap.tab} tab nahi mila. Sheet me wo tab banao, ya config.ts me naam theek karo.`,
    );
  }

  const missing = (['articleId', 'searchCampaignId'] as const).filter(
    (field) => data.index(field) === -1,
  );
  if (missing.length > 0) {
    const names = missing.map((f) => (config.accountMap.columns[f] ?? [f])[0]).join(', ');
    throw new Error(
      `${config.accountMap.tab} ki row 1 me ye columns add karo: ${names}. ` +
        'Inke bina campaign ka record likha nahi ja sakta (aur duplicate ban sakti hai).',
    );
  }
}

export interface CampaignRecord {
  siteId: string;
  customerId: string;
  articleId: string;
  searchCampaignId: string;
  status: string;
  notes: string;
}

/** Campaign ka record AD_ACCOUNT_MAP me ek nayi row ke roop me jodta hai. */
export async function appendCampaignRecord(record: CampaignRecord): Promise<void> {
  const sheets = getClient();
  const data = await readAccountMapTab();
  if (!data) {
    throw new Error(`${config.accountMap.tab} tab nahi mila — campaign record likha nahi ja saka.`);
  }

  const missing = (['articleId', 'searchCampaignId'] as const).filter(
    (field) => data.index(field) === -1,
  );
  if (missing.length > 0) {
    const names = missing.map((f) => (config.accountMap.columns[f] ?? [f])[0]).join(', ');
    throw new Error(`${config.accountMap.tab} me ye columns add karo: ${names}`);
  }

  // Header ke hisaab se ek poori row banate hain.
  const values: string[] = new Array(data.headers.length).fill('');
  const put = (field: string, value: string): void => {
    const i = data.index(field);
    if (i !== -1) values[i] = value;
  };
  put('siteId', record.siteId);
  put('customerId', record.customerId);
  put('articleId', record.articleId);
  put('searchCampaignId', record.searchCampaignId);
  put('status', record.status);
  put('notes', record.notes);

  await withRetry(`${config.accountMap.tab} me likhna`, () =>
    sheets.spreadsheets.values.append({
      spreadsheetId: env.sheetId,
      range: `${config.accountMap.tab}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    }),
  );
}

/** Writes values back into one row. Keys are internal field names. */
export async function writeBack(
  rowNumber: number,
  updates: Partial<Record<string, string>>,
): Promise<void> {
  const sheets = getClient();

  const data: sheets_v4.Schema$ValueRange[] = [];
  for (const [field, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const index = columnIndex(field);
    if (index === -1) continue;
    data.push({
      range: `${env.sheetTab}!${columnLetter(index)}${rowNumber}`,
      values: [[value]],
    });
  }

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: env.sheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });
}
