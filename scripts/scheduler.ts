import { spawn } from 'node:child_process';
import { setDefaultResultOrder } from 'node:dns';
import { env } from '../src/env.js';

setDefaultResultOrder('ipv4first');

const INTERVAL_MINUTES = 15;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

function runScript(scriptPath: string, args: string[] = []): Promise<void> {
  return new Promise((resolve) => {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(`\n⏰ [${timestamp}] Automated 15-min Run: ${scriptPath} ${args.join(' ')}`);

    const child = spawn('npx', ['tsx', scriptPath, ...args], {
      cwd: process.cwd(),
      shell: true,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      console.log(`🏁 [${scriptPath}] Completed with code ${code}`);
      resolve();
    });

    child.on('error', (err) => {
      console.error(`❌ [${scriptPath}] Process error:`, err.message);
      resolve();
    });
  });
}
async function runAutomationCycle(): Promise<void> {
  if (env.killSwitch) {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(`\n🛑 [${timestamp}] ADMIN KILL SWITCH ACTIVE: Skipping campaign creation cycle.`);
    // Chaalu campaigns PAUSE karo, phir reporting sync
    await runScript('scripts/kill.ts', ['--live']);
    await runScript('scripts/report.ts');
    return;
  }

  // 1. Search Ads creation for rows with Search (Y/N) = YES
  await runScript('src/run.ts', ['--live']);
  // 2. Display Ads creation for rows with Display (Y/N) = YES
  await runScript('src/rundisplay.ts', ['--live']);
  // 3. Sync reporting stats back to Sheet
  await runScript('scripts/report.ts');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`🚀 15-Minute Background Scheduler active.`);
console.log(`   Sheet mein 'Search (Y/N) = YES' hote hi automatic process hoga.`);
console.log('═══════════════════════════════════════════════════════════');

// Immediately run first check
void runAutomationCycle();

// Repeat every 15 minutes
setInterval(() => {
  void runAutomationCycle();
}, INTERVAL_MS);
