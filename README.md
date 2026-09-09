# Phase 5 — Google Search Campaign Automation

Master Google Sheet me jis row par **`Search (Y/N) = YES`** hai, us article ke liye:
keywords + Responsive Search Ad banata hai, Google Ads me **PAUSED** Search campaign
banata hai, aur campaign ID wapas Sheet me likh deta hai.

**Koi dashboard nahi, koi server nahi — bas ek script.**

---

## Rule (ye kabhi nahi badlega)

Campaign aur ad group hamesha **PAUSED** banenge. Paisa tab tak kharch nahi hoga jab tak
tum khud Google Ads me jaake **Enable** nahi dabate.

---

## Folder me kya hai

```
Content-automation/
├── .env                 ← SPREADSHEET_ID + GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY yahan
├── config.ts            ← budget, GEO, bid, keyword/ad limits — tumhari settings
├── scripts/preview.ts   ← bina credentials ke output dekhne ke liye
└── src/
    ├── run.ts           ← MAIN file (yahi chalti hai)
    ├── sheet.ts         ← Sheet padhna / likhna
    ├── keywords.ts      ← article se keywords banana
    ├── adcopy.ts        ← headlines + descriptions banana
    ├── plan.ts          ← row ko campaign plan me badalna
    ├── validate.ts      ← URL / budget / GEO check
    ├── googleads.ts     ← Google Ads me campaign banana
    └── logger.ts        ← terminal + file logging
```

---

## Commands

| Command | Kya karta hai |
|---|---|
| `npm run preview` | **Credentials ki zarurat nahi.** Sample article ke keywords + ad copy dikhata hai |
| `npm run token` | Google Ads ka **Refresh Token** generate karta hai (ek hi baar chalana hai) |
| `npm run dry` | Sheet padhta hai, sab kuch banata hai, lekin Google Ads ko **kuch nahi bhejta** |
| `npm run create -- --live` | Asli PAUSED campaigns banata hai |
| `npm run typecheck` | Code me koi type error to nahi, check karta hai |

Extra flags:

```bash
npm run create -- --live --article=A0182   # sirf ek article
npm run create -- --live --limit=3         # sirf 3 rows
npm run token -- --port=3001               # port busy ho to doosra port
npm run token -- --no-open                 # browser khud na khule (server par)
```

---

## Setup (ek baar ka kaam)

### 1. Install
```bash
npm install
```

### 2. Sheet ki chaabi
1. Google Cloud Console → naya project → **Google Sheets API** enable karo
2. **Service Account** banao → **JSON key** download karo
3. JSON file kholo, usme se 2 cheezein `.env` me copy karo:
   - `client_email` → `GOOGLE_CLIENT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY` (ek line me, double quotes ke andar, `\n` waise ke waise)
4. Wahi `client_email` apni Sheet me **Share → Editor** access ke saath daalo

> JSON file ko folder me rakhna zaroori nahi. Chaho to rakh sakte ho — us case me
> `.env` me `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` set kar do aur upar wali 2 lines khaali chhod do.

### 3. Google Ads ki chaabi
Chahiye: Developer Token, Client ID, Client Secret, Refresh Token, Customer ID.

> Naya developer token pehle **Test Access** hota hai — usse sirf test account me
> campaign banti hai. Real account ke liye **Basic Access** apply karna padta hai.

### 4. .env banao
`.env.example` ko copy karke `.env` banao aur values bharo.

---

## Sheet me kaunse columns chahiye

`CONTENT_QUEUE` tab me (header names config.ts me badle ja sakte hain):

**Zaroori:** `Article ID`, `Live URL`, `Search (Y/N)`, `Search Campaign ID`
**Achha rahega:** `Website`, `Title`, `Topic/Intent`, `Brand`, `Category`, `GEO`,
`Template`, `Budget`, `Status`, `Error / Notes`

---

## Script kaise sochti hai

1. Sheet padho
2. Sirf wahi rows uthao jinme — `Search = YES` **aur** `Search Campaign ID` khaali
   **aur** `Live URL` bhara hua
3. Check karo: URL khulta hai? budget cap ke andar? GEO allowed?
4. Keywords banao (banned words hata ke)
5. Headlines (max 30 char) + descriptions (max 90 char) banao
6. Google Ads: budget → campaign (PAUSED) → GEO/language/negatives → ad group (PAUSED)
   → keywords → RSA
7. Sheet me `Search Campaign ID` + `Status = CAMPAIGN_CREATED` likho
8. Fail hua to `Status = ERROR` + wajah `Error / Notes` me

**Duplicate protection:** campaign ID bhar jaane ke baad wo row dobara process nahi hoti.
Script 100 baar chala do, ek article ki campaign sirf ek baar banegi.

---

## Pehli baar chalane ka safe order

```bash
npm run preview                  # 1. keywords/ad copy theek lag rahe hain?
npm run dry                      # 2. Sheet se asli rows uthake dikhao (kuch banega nahi)
npm run create -- --live --limit=1   # 3. test account me sirf 1 campaign
```

Logs `logs/run-YYYY-MM-DD.log` me save hote hain.
