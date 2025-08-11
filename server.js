const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Golden Filter Pro API is running.');
});

app.get('/scan', async (req, res) => {
  try {
    res.status(200).send('Golden Filter Pro scan endpoint is live 🚀');
    // Here you can add your actual scan logic later
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});