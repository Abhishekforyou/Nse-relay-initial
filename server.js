// server.js — NSE Relay (Express + Playwright) with IST + freshness guards

import express from "express";
import pino from "pino";
import { chromium } from "playwright";
import { z } from "zod";

const app = express();
const log = pino({ level: process.env.LOG_LEVEL || "info" });

const PORT = process.env.PORT || 8080;
const TZ = process.env.TZ || "Asia/Kolkata";
const MAX_AGE_LIVE_SECONDS = parseInt(process.env.MAX_AGE_LIVE_SECONDS || "3", 10);
const MAX_AGE_DELAYED_SECONDS = parseInt(process.env.MAX_AGE_DELAYED_SECONDS || "900", 10); // 15m

// ---------- IST helpers ----------
function nowIST() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+05:30`;
}

// ---------- Browser bootstrap (HTTP/2 off, real UA, cookie warm-up) ----------
let browser;
async function withPage(fn) {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-http2",
        "--no-sandbox",
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

  await page.setExtraHTTPHeaders({
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://www.nseindia.com/"
  });

  // Warm cookies (ak_bmsc/bm_sv) once per context
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

// ---------- Robust JSON fetcher w/ retries ----------
async function fetchJSONOnce(page, url) {
  const res = await page.request.get(url, {
    headers: {
      "accept": "application/json, text/plain, */*",
      "cache-control": "no-store",
      "pragma": "no-cache",
      "referer": "https://www.nseindia.com/"
    },
    timeout: 30000
  });
  if (!res.ok()) throw new Error(`Upstream ${url} returned ${res.status()}`);
  return await res.json();
}

async function fetchJSON(page, url, tries = 3, backoffMs = 700) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fetchJSONOnce(page, url); }
    catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw lastErr;
}

// ---------- NSE helpers ----------
async function getSnapshotsFromIndex(page) {
  const idx = encodeURIComponent("NIFTY 200");
  const data = await fetchJSON(page, `https://www.nseindia.com/api/equity-stockIndices?index=${idx}`);
  const ts = data?.metadata?.lastUpdateTime; // e.g. "11-Aug-2025 09:14:57"
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
    const months = { Jan:"01", Feb:"02", Mar:"03", Apr:"04", May:"05", Jun:"06",
                     Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12" };
    const mm = months[monStr];
    const [hh, min, ss] = tpart.split(":");
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`;
  } catch { return null; }
}

function checkFreshness(istISO, mode = "delayed") {
  if (!istISO) return { ok:false, ageSec: Infinity, maxAge: 0 };
  const now = Date.now();
  const ts = new Date(istISO).getTime();
  const ageSec = Math.max(0, Math.round((now - ts) / 1000));
  const maxAge = mode === "live" ? MAX_AGE_LIVE_SECONDS : MAX_AGE_DELAYED_SECONDS;
  return { ok: ageSec <= maxAge, ageSec, maxAge };
}

// ---------- Routes ----------
app.get("/", (_req, res) => {
  res.type("text/plain").send("NSE relay up");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, tz: TZ, now_ist: nowIST() });
});

const QuerySchema = z.object({
  universe: z.string().optional(),          // currently supports nifty200
  mode: z.enum(["live","delayed"]).default("delayed")
});

app.get("/api/nse/snapshot", async (req, res) => {
  const q = QuerySchema.parse({
    universe: String(req.query.universe || ""),
    mode: String(req.query.mode || "delayed")
  });

  try {
    await withPage(async (page) => {
      const snap = await getSnapshotsFromIndex(page);
      const istISO = parseNSETimeToIST(snap.ts);
      const freshness = checkFreshness(istISO, q.mode);

      // same-day (IST) guard
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
    log.error(e, "snapshot_error");
    res.status(503).json({ ok:false, error:"UPSTREAM_UNAVAILABLE", message: e.message });
  }
});

// ---------- Keep server alive ----------
const server = app.listen(PORT, () => {
  log.info({ port: PORT, tz: TZ }, "NSE relay up");
});

// Graceful shutdown
process.on("SIGTERM", async () => { try { await browser?.close(); } catch {} server.close(() => process.exit(0)); });
process.on("SIGINT",  async () => { try { await browser?.close(); } catch {} server.close(() => process.exit(0)); });

// Optional tiny keep-alive (prevents some hosts from idling)
setInterval(() => {}, 60_000);
