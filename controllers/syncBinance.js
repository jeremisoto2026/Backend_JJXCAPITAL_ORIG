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

function getKey() {
  const raw = process.env.ENCRYPTION_KEY || 'default-dev-secret-key';
  return crypto.createHash('sha256').update(raw).digest();
}

function decrypt(enc) {
  try {
    if (!enc || typeof enc !== 'string') return enc;
    const [ivB64, tagB64, ctB64] = enc.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');

    const key = getKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString('utf8');
  } catch (e) {
    console.warn('Decrypt warning:', e.message);
    return enc; // fallback if decryption fails
  }
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
    const db = admin.firestore();

    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Falta userId' });

    // Obtener credenciales guardadas
    const secretDoc = await db.collection('binanceSecrets').doc(userId).get();
    if (!secretDoc.exists) return res.status(404).json({ error: 'No hay claves guardadas para este usuario' });

    const secretData = secretDoc.data();
    const apiKey = secretData.apiKey;
    const apiSecretEncrypted = secretData.apiSecretEncrypted;

    if (!apiKey || !apiSecretEncrypted) {
      return res.status(400).json({ error: 'El usuario no tiene API Keys guardadas' });
    }

    const apiSecret = decrypt(apiSecretEncrypted);

    // connectedAt puede ser un Timestamp de firestore
    const connectedAt = secretData.connectedAt;
    let connectedAtTs;
    if (!connectedAt) {
      // si no hay fecha, usamos NOW (no sincronizamos histórico)
      connectedAtTs = Date.now();
    } else if (connectedAt.toMillis && typeof connectedAt.toMillis === 'function') {
      connectedAtTs = connectedAt.toMillis();
    } else if (connectedAt._seconds) {
      connectedAtTs = connectedAt._seconds * 1000;
    } else {
      connectedAtTs = Date.now();
    }

    // Construimos la query al endpoint de Binance usando startTime = connectedAtTs
    const timestamp = Date.now();
    const qs = `timestamp=${timestamp}&startTime=${connectedAtTs}`;
    const signature = sign(qs, apiSecret);

    const base = process.env.BINANCE_BASE_URL || 'https://api.binance.com';
    // Aquí usamos el endpoint userTrades/tax que tenías en el proyecto original.
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
        const id = (item.orderId || item.tradeId || item.orderNo || item.orderNumber || item.id) || crypto.randomBytes(8).toString('hex');
        const docRef = opsRef.doc(String(id));

        // Mapea los campos mínimos. Ajusta según la estructura que devuelva Binance.
        const op = {
          orderId: item.orderId || item.tradeId || item.orderNo || item.id || null,
          side: item.side || item.type || null,
          asset: item.asset || item.symbol || null,
          amount: item.qty || item.amount || item.quantity || null,
          price: item.price || item.unitPrice || null,
          fee: item.fee || null,
          createTime: item.createTime || item.time || item.tradeTime || Date.now(),
          raw: item,
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
          source: 'binance-p2p'
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