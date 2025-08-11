# NSE Relay (Playwright + Express) — Railway Deploy

A tiny relay API that fetches **fresh NSE snapshot** (LTP, volume, OHLC) with **IST timestamps** and **strict freshness/date guards**.

## Routes
- `GET /health` → `{ ok: true, tz, now_ist }`
- `GET /api/nse/snapshot?universe=nifty200&mode=delayed`
  - Headers: `X-Data-TS-IST`, `X-Freshness-Seconds`, `X-Source`
  - Body: `{ meta, symbols: [{symbol, ltp, volume, ohlc, ts_ist}] }`

## Environment
- `TZ=Asia/Kolkata`
- `SYMBOLS` (optional) use with `universe=symbols`
- `MAX_AGE_LIVE_SECONDS=3`
- `MAX_AGE_DELAYED_SECONDS=900`

## Deploy on Railway
1. Create new Railway project → "New Service" → "Deploy from GitHub".
2. Push this folder to a repo and connect it.
3. Set variables:
   - `TZ=Asia/Kolkata`
   - (optional) `SYMBOLS=RELIANCE,TCS,INFY`
4. Deploy. Visit `/health` to verify.

**Notes**
- Uses Playwright to respect NSE cookies & avoid 403.
- Enforces same‑day (IST) date + freshness.
- Returns 412 when data is too old / wrong date.
