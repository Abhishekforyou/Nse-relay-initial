import express from "express";
import pino from "pino";
import { chromium } from "playwright";
import { z } from "zod";

const app = express();
const log = pino({ level: process.env.LOG_LEVEL || "info" });

const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "Asia/Kolkata";
const DEFAULT_UNIVERSE = process.env.SYMBOLS || ""; // comma-separated list; if empty use NIFTY 200
const MAX_AGE_LIVE_SECONDS = parseInt(process.env.MAX_AGE_LIVE_SECONDS || "3", 10);
const MAX_AGE_DELAYED_SECONDS = parseInt(process.env.MAX_AGE_DELAYED_SECONDS || "900", 10); // 15m

function nowIST() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+05:30`;
}

let browser;
async function withPage(fn) {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-http2",
        "--no-sandbox",               // safe on Railway
        "--disable-dev-shm-usage"
      ]
    });
  }

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const ctx = await browser.newContext({
    timezoneId: TZ,
    locale: "en-IN",
    userAgent: UA
  });

  const page = await ctx.newPage();

  // Realistic default headers for all requests
  await page.setExtraHTTPHeaders({
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://www.nseindia.com/"
  });

  // Preload homepage to get required cookies (bm_sv / ak_bmsc)
  await page.goto("https://www.nseindia.com/", {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  try {
    const result = await fn(page);
    await ctx.close();
    return result;
  } catch (e) {
    await ctx.close();
    throw e;
  }
}

async function fetchJSON(page, url) {
  const res = await page.request.get(url, {
    headers: {
      "accept": "application/json, text/plain, */*",
      "cache-control": "no-store",
      "pragma": "no-cache",
      "referer": "https://www.nseindia.com/"
    }
  });
  if (!res.ok()) throw new Error(`Upstream ${url} returned ${res.status()}`);
  return await res.json();
}

async function getSnapshotsFromIndex(page) {
  const idx = encodeURIComponent("NIFTY 200");
  const data = await fetchJSON(page, `https://www.nseindia.com/api/equity-stockIndices?index=${idx}`);
  const ts = data?.metadata?.lastUpdateTime; // e.g., "11-Aug-2025 09:14:57"
  const rows = (data?.data || []).map(r => ({
    symbol: r.symbol,
    ltp: r.lastPrice,
    volume: r.totalTradedVolume,
    ohlc: { o: r.open, h: r.dayHigh, l: r.dayLow, c: r.previousClose }
  }));
  return { ts, rows };
}

function parseNSETimeToIST(tsStr) {
  try {
    const [dpart, tpart] = tsStr.split(" ");
    const [dd, monStr, yyyy] = dpart.split("-");
    const months = {"Jan":"01","Feb":"02","Mar":"03","Apr":"04","May":"05","Jun":"06",
      "Jul":"07","Aug":"08","Sep":"09","Oct":"10","Nov":"11","Dec":"12"};
    const mm = months[monStr];
    const [hh, min, ss] = tpart.split(":");
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`;
  } catch { return null; }
}

function checkFreshness(istISO, mode="delayed") {
  if (!istISO) return { ok:false, ageSec: Infinity, maxAge: 0 };
  const clientNow = new Date().getTime();
  const ts = new Date(istISO).getTime();
  const ageSec = Math.max(0, Math.round((clientNow - ts)/1000));
  const maxAge = mode === "live" ? MAX_AGE_LIVE_SECONDS : MAX_AGE_DELAYED_SECONDS;
  return { ok: ageSec <= maxAge, ageSec, maxAge };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, tz: TZ, now_ist: nowIST() });
});

const QuerySchema = z.object({
  universe: z.string().optional(),
  mode: z.enum(["live","delayed"]).default("delayed")
});

app.get("/api/nse/snapshot", async (req, res) => {
  const q = QuerySchema.parse({
    universe: String(req.query.universe || ""),
    mode: String(req.query.mode || "delayed")
  });
  try {
    const result = await withPage(async (page) => {
      await page.goto("https://www.nseindia.com", { waitUntil: "domcontentloaded", timeout: 30000 });
      const snap = await getSnapshotsFromIndex(page);
      const istISO = parseNSETimeToIST(snap.ts);
      const freshness = checkFreshness(istISO, q.mode);

      const todayIST = nowIST().slice(0,10);
      const snapDay = istISO ? istISO.slice(0,10) : null;
      if (snapDay !== todayIST) {
        res.setHeader("X-Data-TS-IST", istISO || "unknown");
        res.setHeader("X-Freshness-Seconds", String(freshness.ageSec));
        return res.status(412).json({ ok:false, error:"WRONG_DATE", expected_day: todayIST, got_day: snapDay, ts: istISO });
      }
      if (!freshness.ok) {
        res.setHeader("X-Data-TS-IST", istISO || "unknown");
        res.setHeader("X-Freshness-Seconds", String(freshness.ageSec));
        return res.status(412).json({ ok:false, error:"DATA_TOO_OLD", max_age_seconds: freshness.maxAge, age_seconds: freshness.ageSec, ts: istISO });
      }

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Data-TS-IST", istISO);
      res.setHeader("X-Freshness-Seconds", String(freshness.ageSec));
      res.setHeader("X-Source", "nse-public-headless");
      return res.json({
        meta: { scan_time_ist: nowIST(), universe: "nifty200", count: snap.rows.length },
        symbols: snap.rows
      });
    });
  } catch (e) {
    res.status(503).json({ ok:false, error:"UPSTREAM_UNAVAILABLE", message: e.message });
  }
});

process.on("SIGTERM", async ()=>{ if (browser) await browser.close(); process.exit(0); });
process.on("SIGINT", async ()=>{ if (browser) await browser.close(); process.exit(0); });

app.listen(PORT, () => {
  log.info({ port: PORT, tz: TZ }, "NSE relay up");
});
