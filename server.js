import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("✅ NSE Relay Service is running");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
