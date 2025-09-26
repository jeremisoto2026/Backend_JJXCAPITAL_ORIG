// controllers/verifyBinanceKeys.js
const axios = require('axios');
const crypto = require('crypto');

function sign(qs, secret) {
  return crypto.createHmac('sha256', secret).update(qs).digest('hex');
}

module.exports = async function verifyBinanceKeys(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, error: 'Method not allowed' });
    }

    const { apiKey, apiSecret } = req.body;
    if (!apiKey || !apiSecret) return res.status(400).json({ ok:false, error: "Faltan apiKey/apiSecret" });

    const timestamp = Date.now();
    const qs = `timestamp=${timestamp}`;
    const signature = sign(qs, apiSecret);

    const base = process.env.BINANCE_BASE_URL || 'https://api.binance.com';
    // Endpoint estándar para verificar credenciales: account (firma requerida)
    const url = `${base}/api/v3/account?${qs}&signature=${signature}`;

    const response = await axios.get(url, {
      headers: { 'X-MBX-APIKEY': apiKey },
      timeout: 15000,
      validateStatus: () => true
    });

    if (response.status === 200) {
      return res.json({ ok: true, message: 'Claves válidas' });
    }

    return res.status(response.status).json({ ok:false, error: 'Binance respondió error', details: response.data });
  } catch (err) {
    console.error('verify error', err?.response?.data || err.message);
    return res.status(500).json({ ok:false, error: err?.response?.data || err.message });
  }
};