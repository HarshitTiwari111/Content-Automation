/**
 * Kill switch — Sheet ki saari chaalu Search/Display campaigns PAUSE karta hai.
 *
 *   npm run kill -- --live
 */
import { setDefaultResultOrder } from 'node:dns';
import { assertSheetEnv } from '../src/env.js';
import { pauseAllCampaigns } from '../src/killswitch.js';
import { logger } from '../src/logger.js';

setDefaultResultOrder('ipv4first');

void (async () => {
  assertSheetEnv();
  await pauseAllCampaigns();
})().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
