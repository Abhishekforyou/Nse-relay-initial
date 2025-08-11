const express = require('express');
const request = require('request-promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/stock', async (req, res) => {
    const symbol = req.query.symbol;
    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }

    try {
        const response = await request({
            uri: `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': '*/*',
                'Connection': 'keep-alive'
            },
            proxy: `http://${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD}@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`,
            json: true
        });
        res.json(response);
    } catch (err) {
        console.error('Error fetching stock data:', err.message);
        res.status(500).json({ error: 'Failed to fetch stock data' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});