const express = require("express");
const axios = require("axios");
const app = express();
require("dotenv").config();

const PROXY_CONFIG = {
  host: process.env.PROXY_HOST,
  port: process.env.PROXY_PORT,
  auth: {
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD,
  },
};

app.get("/api/stock", async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: "Missing stock symbol" });

  try {
    const url = `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`;
    const response = await axios.get(url, {
      proxy: PROXY_CONFIG,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/58.0.3029.110 Safari/537.3",
        Referer: "https://www.nseindia.com",
      },
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch data", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));