// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const binanceRoutes = require('./routes/binanceRoutes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 })); // 60 req/min
app.use('/api', binanceRoutes);

app.get('/', (req, res) => res.send('Backend JJXCAPITAL activo'));

// 👇 Exportamos app para que Vercel lo use
module.exports = app;