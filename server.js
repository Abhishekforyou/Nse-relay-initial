const express = require('express');
const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const proxy = 'http://lmykedsz-1:8so8ew9nssb4@p.webshare.io:80';
const agent = new HttpsProxyAgent(proxy);

app.get('/api/stock', async (req, res) => {
  const { symbol } = req.query;

  try {
    const response = await axios.get(`https://www.nseindia.com/api/quote-equity?symbol=${symbol}`, {
      httpsAgent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching stock data:', error.message);
    res.status(500).json({ error: 'Failed to fetch stock data' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});