# AI YouTube Channel Analyst — Telegram Bot

A private Telegram bot that analyzes **your own YouTube channel** using the official YouTube Data API v3 + YouTube Analytics API v2, and uses **Google Gemini** to produce practical, evidence-based recommendations. Deployed free on Vercel with a free Neon Postgres database.

Everything runs on **$0 tiers**: Telegram Bot API, YouTube APIs (standard quota), Gemini free tier, Vercel Hobby, Neon free Postgres.

---

## Features

| Command | What it does |
|---|---|
| `/start`, `/help` | Welcome + full command list |
| `/status` | Which env vars are configured, OAuth channel check, last sync, stored errors |
| `/sync` | Pull channel + video metadata and analytics snapshots into the database |
| `/report` | Real analytics report: 7-day window vs previous 7 days, view/watch-time/sub trends, Shorts vs long-form split |
| `/videos` | Top 10 videos by views (per-video Analytics window) |
| `/shorts` | Top Shorts, compared only against other Shorts |
| `/longform` | Top long-form videos, compared only against other long-form |
| `/trends` | Growth trends built from stored daily snapshots |
| `/weekly` | Full AI report: all 11 sections from section 6 of the requirements |
| `/ideas` | 5 AI video ideas grounded in your actual data |
| `/analyze VIDEO_ID` | Deep dive on one video (metadata + analytics + daily views) |
| `/title VIDEO_ID` | Title problem diagnosis + 6 alternatives with rationale |
| `/thumbnail VIDEO_ID` | 4 thumbnail concepts (visual, overlay text, why) |
| `/chat QUESTION` | Q&A restricted to your real channel data |
| unknown | Helpful message pointing to `/help` |

**Security**: only your Telegram user ID can use it; webhook calls must carry Telegram's secret token header; duplicate updates are dropped (memory + database); per-rate-limits; no secrets are ever printed in messages or logs.

---

## How the data works (important, honest limitations)

- **YouTube Analytics API reports have a 48–72 hour delay.** The bot therefore always queries up to **3 days ago** (`src/utils/dates.js → analyticsWindow`). Yesterday will show nothing; that is normal.
- **Impressions and click-through rate are NOT available** through standard targeted-query reports for this scope — the bot never shows them rather than faking them.
- **Shorts identification is heuristic**: duration ≤ 60 seconds from the Data API (`src/youtube/videos.js`). The analytics API does not expose a per-video "is Short" flag.
- **`subscribersGained/Lost` per video** only counts the video's watch page.
- `averageViewPercentage` is returned when YouTube supports it for the report; otherwise the bot prints gaps honestly.
- AI responses are constrained to quote only the supplied data, to compare Shorts with Shorts and long-form with long-form, to label hypotheses vs facts, and to never promise results. Structured JSON is validated; invalid responses produce a retry-friendly error, never numbers the bot invented.

## Free-tier reality check

| Service | Free limit | This project's use |
|---|---|---|
| Telegram Bot API | Free | Webhook only |
| YouTube Data API | 10,000 units/day | ~50–100 units per /sync |
| YouTube Analytics API | Standard (free) workload | A handful of reports per sync |
| Gemini API free tier | Per-model RPD/RPM limits; `gemini-3.8-flash` (default) is free of charge | A few AI calls per manual command |
| Vercel Hobby | Free; cron restricted to **once per day**; function connection ~60s here | 1 daily cron + webhook |
| Neon Postgres free | Stores (small analytics storage) | Snapshots of 200 videos/day |

Known constraints: Vercel Hobby cron timing drifts (±59 min) and triggers aren't retried. Telegram webhooks must respond quickly — this project answers in-process within 60s (Gemini flash is usually fast).

---

## Prerequisites (Windows)

1. Node.js 20+ — `node --version`
2. A Telegram account + your numeric user ID
3. A Google account that owns the YouTube channel
4. (Optional but recommended) Git + a GitHub account for Vercel deploys

## Step 1 — Create the Telegram bot

```powershell
# In Telegram, chat with @BotFather -> /newbot -> choose a name and username
# BotFather prints a token like 123456789:AAE...
```

Now grab your numeric user ID by chatting with **@userinfobot** (it replies `Id: 123456789`).

## Step 2 — Google Cloud setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. Enable **YouTube Data API v3** and **YouTube Analytics API** (APIs & Services → Library). *You already did this.*
3. APIs & Services → **OAuth consent screen** → External → fill app name/email → **Add yourself as a Test user** → save. (Testing mode: refresh tokens keep working for your test users, but Google may expire them in 7 days for other users; when ready, click "Publish app" — with only sensitive-but-blocking-free scopes you don't need verification for your own account; re-authorize after publishing.)
4. APIs & Services → **Credentials** → Create credentials → OAuth client ID:
   - Type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:8080`  (for the local script)
     - `https://YOUR-APP.vercel.app/api/oauth/callback` (add after deploying)
5. Save **YOUTUBE_CLIENT_ID** and **YOUTUBE_CLIENT_SECRET**.

## Step 3 — Gemini API key

1. Open [aistudio.google.com](https://aistudio.google.com) → Get API key → create one in a free project.
2. The default model here is **`gemini-3.8-flash`** (verified free of charge, Oct 2026, and named by Google for new projects). You can verify the exact free models Live at any time:

```powershell
curl.exe "https://generativelanguage.googleapis.com/v1beta/models" -H "x-goog-api-key: YOUR_KEY"
```

3. Save as `GEMINI_API_KEY`.

## Step 4 — Free database (Neon)

1. Create an account at [neon.com](https://neon.com) → new project → copy the connection string (starts with `postgresql://`).
2. Save as `DATABASE_URL`. (Supabase Postgres also works with the same URL, using its "Direct connection" string.)

## Step 5 — Local setup (PowerShell)

```powershell
cd C:\Users\100290\Downloads\Telegram analysis YT
git init
Copy-Item .env.example .env
notepad .env
```

Fill in:

```dotenv
TELEGRAM_BOT_TOKEN=123456:AA... 
TELEGRAM_WEBHOOK_SECRET=some-long-random-string
OWNER_TELEGRAM_ID=123456789
CRON_SECRET=another-long-random-string
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-3.8-flash
YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-...
DATABASE_URL=postgresql://...
APP_BASE_URL=http://localhost:8080
```

Generate two long random secrets:

```powershell
-join ((97..122) + (48..57) | Get-Random -Count 40 | % {[char]$_})
```

Install and test:

```powershell
npm install
npm test            # 44 unit tests, no credentials needed
```

## Step 6 — Generate the YouTube refresh token locally

```powershell
npm run authorize     # runs scripts/authorize-youtube.js with .env loaded
```

- A local server listens on `http://localhost:8080` — that redirect URI must already be registered (Step 2.4).
- Open the printed consent URL in a browser. **Sign in with the account that owns the channel** (not a secondary Google account).
- The script prints `YOUTUBE_REFRESH_TOKEN=...`. Paste it into `.env`.

Token hygiene notes:
- The token is **never printed in logs** by the bot itself; only this one-time local script shows it to you.
- If you revoke access in [myaccount.google.com/permissions](https://myaccount.google.com/permissions), the token dies → `/status` will report a channel-check failure → re-run this script.
- Tokens obtained under Google *Testing* configuration can expire after 7 days for non-test users; keeping yourself listed as a Test user (or publishing the app) avoids this.

## Step 7 — Verify locally (optional but recommended)

```powershell
npm run sync        # stores channel + videos + analytics snapshots in Neon
npm run webhook check
```

## Step 8 — Deploy to Vercel

```powershell
npm i -g vercel
vercel login
vercel            # link the project (Framework: Other; root folder: this repo)
```

Set environment variables in the dashboards — duplicate `.env` values (Vercel Dashboard → Project → Settings → Environment Variables, or `vercel env add KEY`, entering values by prompt). Add all keys from `.env.example`, **plus** `APP_BASE_URL=https://your-app.vercel.app`.

Deploy production:

```powershell
vercel --prod
```

Or push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new) — every git push deploys.

Register the Telegram webhook (points Telegram at Vercel):

```powershell
$env:APP_BASE_URL="https://your-app.vercel.app"
npm run webhook        # set
npm run webhook check  # verify: url correct, last_error_message absent
```

`vercel.json` already declares:
- webhook + OAuth functions at the right paths
- a daily cron `0 4 * * *` → `api/cron/daily-sync.js` (protected by `CRON_SECRET`; Hobby constraints: once/day, timing drifts ±59 min — fine for daily snapshots)

## Step 9 — Test every command

In Telegram (from your owner account):

```text
/status              -> all env vars ✅, channel authorized
/sync                -> row counts, no warnings
/videos /shorts /longform
/report /trends
/ideas /weekly
/analyze VIDEO_ID    (an 11-char ID from /videos)
/title VIDEO_ID
/thumbnail VIDEO_ID
/chat which video format drove subscriber growth lately?
```

Note: `/analyze`, `/title`, `/thumbnail` need analytics rows for your video; videos published today may have no Analytics rows yet (48–72h delay).

**Verify authorization is enforced:** send `/report` from any *other* Telegram account — it must reply "This bot is private" and nothing else.

**Verify webhook secret:** visit `https://your-app.vercel.app/api/webhook` in a browser (GET/POST without secret header) → 401/405, never channel data.

## Step 10 — Check Vercel logs

```powershell
vercel logs --prod
```

or Dashboard → Project → Logs. Errors are logged as single-line JSON with a `context` field and a short message — never token/key values.

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `/report` shows no daily rows | Analytics delay (48–72h) or first `/sync` not run. Run `/sync`, wait 1–2 days, sync again. |
| `/status`: "channel check failed ... invalidCredentials" | Refresh token expired/revoked → re-run `npm run authorize`. |
| `/status`: "authenticated account has no YouTube channel" | You authorized a Google account without a channel → re-authorize the correct account. |
| Gemini error mentioning rate limit | Free-tier RPM hit; wait ~1 minute and retry. |
| DB commands say "needs a database" | `DATABASE_URL` missing in Vercel env → add + redeploy. |
| Webhook returns 401 | `TELEGRAM_WEBHOOK_SECRET` in Vercel differs from the one used in `npm run webhook` → re-register. |
| Cron returns 401 | `CRON_SECRET` missing on Vercel (Vercel *does not* auto-inject it on all projects — set it yourself). |
| Hobby cron fails deployment with "more than once per day" | vercel.json schedule must stay once/day on Hobby (this project uses `0 4 * * *`). |
| No `refresh_token` in step 6 | The account already consented before → revoke app in Google account settings, re-run (we always send `prompt=consent`). |

## Costs you could trigger (none, on purpose)

- Google Cloud: enabling the two APIs is free; standard quotas are free. Don't switch to "unrestricted" keys on projects with billing attached to other paid APIs.
- Gemini: paid tiers only charge when you explicitly enable billing on the project — the free tier stays free.
- Vercel: Hobby enough for this workload (few requests/day). Upgrading is never needed by this project's design.
- Neon: store rows are small; a daily 200-video snapshot history is well under free storage.

## Project structure

```text
ai-youtube-analyst/
├── api/
│   ├── webhook.js             # Telegram webhook (secret-header + owner + dedupe + rate-limit)
│   ├── health.js              # NO secrets status endpoint
│   ├── cron/daily-sync.js     # daily snapshot (Bearer CRON_SECRET)
│   └── oauth/{start,callback}.js
├── src/
│   ├── config.js
│   ├── telegram/{client,commands,security}.js
│   ├── youtube/{auth,analytics,videos}.js
│   ├── gemini/analyst.js
│   ├── database/{db.js,schema.sql}
│   ├── services/{sync,report,recommendations}.js
│   └── utils/{dates,formatting,errors}.js
├── scripts/{authorize-youtube,register-webhook,run-sync}.js
├── tests/                     # node --test, no credentials needed
├── vercel.json
├── .env.example
└── README.md
```

## Security checklist

- [x] Owner-only: every command checked against `OWNER_TELEGRAM_ID` before any API/AI work
- [x] `X-Telegram-Bot-Api-Secret-Token` constant-time compared
- [x] Update ID dedupe: in-memory ring + `processed_updates` PK insert
- [x] Rate limits: 20/min general, 6/min for AI commands
- [x] Input validation: video IDs regex-checked, args length-capped
- [x] Message length: chunked at 4000 chars (Telegram limit is 4096)
- [x] Secrets: read only from env; never logged, never sent in messages; `.env.example` has no real values
- [x] Duplicate/unknown JSON gracefully ignored; malformed data never crashes the webhook
- [x] Revoked refresh token → explicit recovery instructions in `/status`

## What this project deliberately does NOT do

- Does not upload/modify YouTube content (read-only scopes only)
- Does not scrape YouTube Studio or estimate unavailable metrics
- Does not present AI hypotheses as fact — every AI message labels experiments and confidence limits
