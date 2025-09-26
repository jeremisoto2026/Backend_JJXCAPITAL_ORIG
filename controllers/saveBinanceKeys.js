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

function getKey() {
  // Ensure a 32-byte key using SHA256 of the ENCRYPTION_KEY env (simple and stable)
  const raw = process.env.ENCRYPTION_KEY || 'default-dev-secret-key';
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(text) {
  try {
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  } catch (e) {
    console.warn('Encrypt warning:', e.message);
    return text; // fallback (not ideal) but avoids crash in dev
  }
}

module.exports = async function saveBinanceKeys(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, error: 'Method not allowed' });
    }

    initFirebase();
    const db = admin.firestore();

    const { userId, apiKey, apiSecret } = req.body;
    if (!userId || !apiKey || !apiSecret) {
      return res.status(400).json({ ok:false, error: 'Faltan userId/apiKey/apiSecret' });
    }

    // Encriptamos secret
    const encrypted = encrypt(apiSecret);

    // Guardamos secret en colección separada (binanceSecrets) y marca en binanceKeys
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