/**
 * Google Ads connection test — SIRF PADHTA HAI.
 * Koi campaign, budget ya ad nahi banata. Sheet ko chhuta bhi nahi.
 *
 *   npm run check
 *
 * Yeh batata hai ki proxy ka URL, refresh token aur customer id sahi hain
 * ya nahi — asli campaign banane se pehle isse check kar lo.
 */
import { setDefaultResultOrder } from 'node:dns';
import { env } from '../src/env.js';
import { searchAds } from '../src/googleads.js';

setDefaultResultOrder('ipv4first');

const customerId = process.argv.find((a) => a.startsWith('--customer='))?.split('=')[1] ?? env.ads.customerId;

async function main(): Promise<void> {
  console.log('');
  console.log('─────────── Google Ads connection test ───────────');
  console.log(`Proxy      : ${env.ads.proxyBaseUrl}`);
  console.log(`Version    : ${env.ads.apiVersion}`);
  console.log(`Customer   : ${customerId || '(khaali)'}`);
  console.log(`Login (MCC): ${env.ads.loginCustomerId || '(nahi diya)'}`);
  console.log(`Token      : ${env.ads.refreshToken ? `mila (${env.ads.refreshToken.length} chars)` : '❌ khaali'}`);
  console.log('');

  if (!customerId) {
    console.log('❌ Customer ID nahi hai.');
    console.log('   .env me GOOGLE_ADS_CUSTOMER_ID bharo, ya aise chalao:');
    console.log('   npm run check -- --customer=1234567890');
    process.exitCode = 1;
    return;
  }

  try {
    // Yahi query proxy ke spec ke example #1 me di gayi hai (MCC se client
    // accounts ki list). Isse pata chal jaata hai ki token aur access theek hai.
    const result = await searchAds(
      customerId,
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.level ' +
        'FROM customer_client WHERE customer_client.level <= 1',
    );
    console.log('✅ Connection theek hai. Account ka jawab:');
    console.log(JSON.stringify(result, null, 2).slice(0, 1500));
  } catch (error) {
    console.log('❌ Connection fail:');
    console.log(`   ${error instanceof Error ? error.message : String(error)}`);
    console.log('');
    console.log('Aksar iski wajah:');
    console.log('  • refresh token galat ya expire  → naya token banao');
    console.log('  • customer id galat             → Google Ads me upar right corner wala number');
    console.log('  • us account ka access nahi     → jis Google account se login kiya, usko access do');
    process.exitCode = 1;
  }
  console.log('');
}

void main();
