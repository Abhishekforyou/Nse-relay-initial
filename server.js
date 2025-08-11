const express = require("express");
const axios = require("axios");
const app = express();
require("dotenv").config();

const PORT = process.env.PORT || 3000;
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;

app.get("/api/stock", async (req, res) => {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).send("Symbol is required");

    try {
        const response = await axios.get(
            `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`,
            {
                proxy: {
                    host: PROXY_HOST,
                    port: parseInt(PROXY_PORT),
                    auth: {
                        username: PROXY_USER,
                        password: PROXY_PASS,
                    },
                },
                headers: {
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "application/json",
                },
            }
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch data", details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});