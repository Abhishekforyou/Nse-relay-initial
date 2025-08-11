
const express = require('express');
const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');

const app = express();
const port = process.env.PORT || 3000;

require('dotenv').config();

app.get('/scan', async (req, res) => {
  try {
    const proxyHost = process.env.PROXY_HOST;
    const proxyPort = parseInt(process.env.PROXY_PORT);
    const proxyUser = process.env.PROXY_USERNAME;
    const proxyPass = process.env.PROXY_PASSWORD;

    const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    const response = await axios.get('https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050', {
      httpsAgent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch data',
      details: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
