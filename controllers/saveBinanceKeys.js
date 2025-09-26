// controllers/saveBinanceKeys.js
const admin = require('firebase-admin');
const crypto = require('crypto');

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
if (!KEY || KEY.length !== 32) {
  console.warn('BACKEND_SECRET_HEX no configurado correctamente (64 hex chars).');
}

function encryptGCM(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

module.exports = async function saveBinanceKeys(req, res) {
  try {
    initFirebase();
    const { userId, apiKey, apiSecret } = req.body;
    if (!userId || !apiKey || !apiSecret) return res.status(400).json({ ok:false, error: 'Faltan parámetros (userId/apiKey/apiSecret)' });

    const db = admin.firestore();
    const encrypted = encryptGCM(apiSecret);

    await db.collection('binanceSecrets').doc(userId).set({
      apiKey,
      apiSecretEncrypted: encrypted,
      connectedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await db.collection('binanceKeys').doc(userId).set({
      apiKeyMasked: `${apiKey.slice(0,6)}...${apiKey.slice(-6)}`,
      connectedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.json({ ok: true, message: 'Claves guardadas correctamente' });
  } catch (err) {
    console.error('save keys error', err);
    return res.status(500).json({ ok:false, error: err.message || err });
  }
};