// server.js — FINAL (defaults enabled)
// Routes:
//   /           -> status text
//   /health     -> IST timestamp
//   /nse        -> NSE snapshot (defaults: index="NIFTY 200", maxAge=900)
//   /nse?index=NIFTY%2050&maxAge=600 -> override defaults

import express from "express";
import { setTimeout as delay } from "timers/promises";

const app = express();
const PORT = process.env.PORT || 8080;
const TZ = "Asia/Kolkata";

// ---------- helpers ----------
function nowISTISO() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+05:30`;
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

function freshness(istISO, maxAgeSec) {
  if (!istISO) return { ok:false, ageSec:Infinity, maxAgeSec };
  const ageSec = Math.max(0, Math.round((Date.now() - new Date(istISO).getTime())/1000));
  return { ok: ageSec <= maxAgeSec, ageSec, maxAgeSec };
}

async function fetchJSON(url, tries = 4) {
  let lastErr;
  for (let i=0; i<tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "accept": "application/json, text/plain, */*",
          "cache-control": "no-store",
          "pragma": "no-cache",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          "referer": "https://www.nseindia.com/"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await delay(400 * (i+1)); // backoff
    }
  }
  throw lastErr;
}

// ---------- routes ----------
app.get("/", (_req, res) =>
  res.type("text/plain").send("✅ NSE Relay is up. Try /health and /nse")
);

app.get("/health", (_req, res) =>
  res.json({ ok:true, tz:TZ, now_ist: nowISTISO() })
);

// Defaults here mean /nse works with NO query params
app.get("/nse", async (req, res) => {
  const index = (req.query.index ? String(req.query.index) : "NIFTY 200");
  const maxAge = Number(req.query.maxAge || 900); // seconds

  try {
    const url = `https://www.nseindia.com/api/equity-stockIndices?index=${encodeURIComponent(index)}`;
    const data = await fetchJSON(url);

    const ts = data?.metadata?.lastUpdateTime || null;  // e.g., "11-Aug-2025 15:29:59"
    const istISO = ts ? parseNSETimeToIST(ts) : null;

    // same-day guard (IST)
    const today = nowISTISO().slice(0,10);
    const snapDay = istISO ? istISO.slice(0,10) : null;
    if (snapDay !== today) {
      return res.status(412).json({ ok:false, error:"WRONG_DATE", expected_day: today, got_day: snapDay, ts_ist: istISO });
    }

    // freshness guard
    const age = freshness(istISO, maxAge);
    if (!age.ok) {
      return res.status(412).json({ ok:false, error:"DATA_TOO_OLD", age_seconds: age.ageSec, max_age_seconds: age.maxAgeSec, ts_ist: istISO });
    }

    const rows = (data?.data || []).map(r => ({
      symbol: r.symbol,
      ltp: r.lastPrice,
      volume: r.totalTradedVolume,
      ohlc: { o: r.open, h: r.dayHigh, l: r.dayLow, c: r.previousClose }
    }));

    res.json({
      ok: true,
      meta: { index, ts_ist: istISO, scan_time_ist: nowISTISO(), count: rows.length },
      symbols: rows
    });
  } catch (e) {
    res.status(503).json({ ok:false, error:"UPSTREAM_UNAVAILABLE", message: e.message });
  }
});

// ---------- start ----------
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
