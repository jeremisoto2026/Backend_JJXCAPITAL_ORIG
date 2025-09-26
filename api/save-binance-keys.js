// api/save-binance-keys.js
import admin from "firebase-admin";
import crypto from "crypto";

// --- INIT FIREBASE ---
function initFirebaseAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

// --- AES-256-GCM encrypt ---
const KEY = Buffer.from(process.env.BACKEND_SECRET_HEX, "hex");
function encryptGCM(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

// --- HANDLER ---
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    initFirebaseAdmin();
    const { userId, apiKey, apiSecret } = req.body;

    if (!userId || !apiKey || !apiSecret) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    // 🔒 Encriptar secret
    const encryptedSecret = encryptGCM(apiSecret);

    const db = admin.firestore();

    // Guardar secret en binanceSecrets (solo backend)
    await db.collection("binanceSecrets").doc(userId).set(
      {
        apiKey,
        apiSecretEncrypted: encryptedSecret,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Guardar info visible en binanceKeys (para frontend)
    await db.collection("binanceKeys").doc(userId).set(
      {
        apiKeyMasked: `${apiKey.slice(0, 6)}...${apiKey.slice(-6)}`,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true, message: "Claves guardadas correctamente" });
  } catch (err) {
    console.error("💥 Error en save-binance-keys:", err);
    return res.status(500).json({ error: err.message });
  }
}