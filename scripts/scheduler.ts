import { spawn } from 'node:child_process';
import { setDefaultResultOrder } from 'node:dns';
import { killSwitchSource } from '../src/killswitch.js';

setDefaultResultOrder('ipv4first');

const INTERVAL_MINUTES = 15;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

/**
 * Health check din me do baar — subah 9:00 aur dopahar 2:30 (India time).
 * Har 15 min nahi, warna Google Ads ki request limit lag jaati hai.
 */
const HEALTH_TIMES = ['09:00', '14:30'];
const healthDone = new Set<string>();

/** India time ka { date: '2026-10-22', minutes: 570 }. */
function istNow(): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Us din us waqt ka health check ho chuka hai ya nahi. */
function healthSlotDue(): string | null {
  const now = istNow();
  for (const slot of HEALTH_TIMES) {
    const [h, m] = slot.split(':');
    const slotMinutes = Number(h) * 60 + Number(m);
    const key = `${now.date} ${slot}`;
    if (healthDone.has(key)) continue;
    // Us slot ke baad wali pehli cycle me chalega.
    if (now.minutes >= slotMinutes && now.minutes < slotMinutes + INTERVAL_MINUTES) return key;
  }
  return null;
}

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
  let killSource = '';
  try {
    killSource = await killSwitchSource();
  } catch (error) {
    // Kill switch padh hi nahi paye — campaign banana safe nahi, is baar chhod do.
    console.error(`❌ Kill switch padh nahi paye: ${(error as Error).message} — ye cycle skip.`);
    return;
  }

  if (killSource) {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(`\n🛑 [${timestamp}] KILL SWITCH ON (${killSource}): campaign creation skip.`);
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

  // 4. Health check — din me sirf do baar (9:00 aur 14:30 IST).
  const slot = healthSlotDue();
  if (slot) {
    healthDone.add(slot);
    await runScript('scripts/health.ts');
  }
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
