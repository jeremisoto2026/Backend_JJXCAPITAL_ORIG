// controllers/syncBinance.js
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');

function initFirebase() {
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    } else {
      const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';
      const sa = require(path);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
  }
}

const KEY = Buffer.from(process.env.BACKEND_SECRET_HEX || '', 'hex');

function decryptGCM(payload) {
  const [ivB64, tagB64, ctB64] = payload.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}

function sign(qs, secret) {
  return crypto.createHmac('sha256', secret).update(qs).digest('hex');
}

module.exports = async function syncBinance(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }

    initFirebase();
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Falta userId' });

    const db = admin.firestore();
    const secretDoc = await db.collection('binanceSecrets').doc(userId).get();
    if (!secretDoc.exists) return res.status(404).json({ error: 'No hay claves registradas' });

    const { apiKey, apiSecretEncrypted, connectedAt } = secretDoc.data();
    if (!apiKey || !apiSecretEncrypted) return res.status(400).json({ error: 'Claves incompletas' });

    const apiSecret = decryptGCM(apiSecretEncrypted);
    const connectedAtTs = connectedAt?._seconds ? connectedAt._seconds * 1000 : Date.now();

    const timestamp = Date.now();
    const qs = `timestamp=${timestamp}&startTime=${connectedAtTs}`;
    const signature = sign(qs, apiSecret);

    const base = process.env.BINANCE_BASE_URL || 'https://api.binance.com';
    const url = `${base}/sapi/v1/tax/userTrades?${qs}&signature=${signature}`;

    const response = await axios.get(url, {
      headers: { 'X-MBX-APIKEY': apiKey },
      timeout: 20000,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      console.error('Binance error:', response.status, response.data);
      return res.status(500).json({ error: 'Error llamando a Binance', details: response.data });
    }

    const data = response.data;
    const rows = Array.isArray(data) ? data : (data?.data || data?.rows || []);

    let saved = 0;
    if (rows.length > 0) {
      const batch = db.batch();
      const opsRef = db.collection('users').doc(userId).collection('operations');

      for (const item of rows) {
        const id = (item.orderId || item.tradeId || item.orderNo || item.id) ? String(item.orderId || item.tradeId || item.orderNo || item.id) : crypto.randomBytes(8).toString('hex');
        const docRef = opsRef.doc(id);
        const op = {
          source: 'binance-tax',
          raw: item,
          syncedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        batch.set(docRef, op, { merge: true });
        saved++;
      }
      await batch.commit();
    }

    return res.json({ ok: true, operationsSaved: saved, connectedAt: connectedAtTs });
  } catch (err) {
    console.error('sync error', err?.response?.data || err.message || err);
    return res.status(500).json({ error: err?.response?.data || err.message || err });
  }
};