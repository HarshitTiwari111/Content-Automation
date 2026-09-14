# Google Ads Automation — Phase 4 (Display), Phase 5 (Search), Phase 6 (Reporting)

Master Google Sheet (`CONTENT_QUEUE`) me:
- **`Search Ads (Y/N) = YES`** → keywords + Responsive Search Ad ke saath **PAUSED** Search campaign
- **`Display (Y/N) = YES`** → images + Responsive Display Ad ke saath **PAUSED** Display campaign

Campaign ID, Status aur error usi row me wapas likhe jaate hain.

---

## Rule (ye kabhi nahi badlega)

Campaign, ad group aur ad hamesha **PAUSED** banenge. Paisa tab tak kharch nahi hoga jab tak
tum khud Google Ads me jaake **Enable** nahi dabate.

---

## Commands

| Command | Kya karta hai |
|---|---|
| `npm run check` | Google Ads token/proxy connection test (sirf padhta hai) |
| `npm run preview -- --article=A0182` | Ek article ke keywords + ad copy dikhata hai |
| `npm run dry` | Search: Sheet padhta hai, sab banata hai, Google Ads ko **kuch nahi bhejta** |
| `npm run create -- --live` | Asli PAUSED Search campaigns banata hai |
| `npm run display:dry` | Display ka dry run |
| `npm run display -- --live` | Asli PAUSED Display campaigns banata hai |
| `npm run report` | Search + Display ka clicks/spend/CPC/status REPORTING tab me |
| `npm run kill -- --live` | Sheet ki saari chaalu campaigns PAUSE karta hai |
| `npm run typecheck` | Code me type error check |

Extra flags: `--article=A0182` (sirf ek article), `--limit=3` (sirf 3 rows).

GitHub se bina terminal: **Actions → Create Search campaigns / Create Display campaigns /
Sync reporting → Run workflow**.

---

## Setup

1. `npm install`
2. `.env.example` ko copy karke `.env` banao aur bharo:
   - **Sheet:** `SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (service account;
     wahi email Sheet me Editor access ke saath share karo)
   - **Google Ads (proxy ke through):** `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`,
     `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. Client ID / Client Secret / Developer Token **nahi** chahiye —
     proxy handle karti hai. Refresh token `https://secure.dataram.workers.dev/auth/login` se aata hai.
   - **AI copy:** `OPENAI_API_KEY`
3. GitHub Actions use karna ho to yahi values **Settings → Secrets and variables → Actions** me daalo.

---

## Sheet tabs

| Tab | Kaam |
|---|---|
| `CONTENT_QUEUE` | Article rows + Search/Display switches + campaign IDs |
| `WEBSITE_CONFIG` | Domain → Site ID (campaign ke naam ke liye) |
| `AD_ACCOUNT_MAP` | Site ID → Google Ads CID (har site ka apna account) |
| `CAMPAIGN_TEMPLATES` | Allowed GEOs, Device, Daily Budget Cap, Max Bid |
| `ERROR_LOG` | Har fail hui row ka record |
| `REPORTING` | Din-wise clicks, spend, CPC, status (`Status` column ho to state bhi likha jata hai) |

---

## Safety checks (PDF section 14 / 16)

- Live URL khulta hai aur Website se match karta hai
- Duplicate nahi: campaign ID bhar jaane ke baad row dobara process nahi hoti
- Budget template ke cap aur **account-level cap** (`config.ts → budget`) ke andar
- GEO/language allowed; Device rule template se lagta hai (Mobile / Desktop / Tablet / All)
- Keywords (Search) aur images (Display) maujood — bina keyword ki Search campaign nahi banti
- Run shuru hone se pehle Google Ads token aur account access check
- **Kill switch (admin):** Sheet ke upar **🛑 Kill Switch → ON** (SETTINGS tab, sirf admin ke
  liye protected). Developer `.env` / GitHub Variables me `PAID_TRAFFIC_KILL_SWITCH=true` bhi kar
  sakta hai. Dono me se koi bhi ON → nayi campaign nahi banegi aur chaalu campaigns agli run pe
  PAUSE ho jayengi. Menu ka code: `apps-script/KillSwitch.gs`

Logs `logs/run-YYYY-MM-DD.log` me save hote hain.
