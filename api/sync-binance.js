// api/sync-binance.js
import crypto from "crypto";
import admin from "firebase-admin";
import fetch from "node-fetch"; // 👈 asegúrate que esté en package.json

// --- INIT FIREBASE ---
function initFirebaseAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

// --- HELPERS ---
function signRequest(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

// 🔒 AES-256-GCM decrypt (apiSecret encriptado en Firestore)
const KEY = Buffer.from(process.env.BACKEND_SECRET_HEX, "hex");
function decryptGCM(payload) {
  const [ivB64, tagB64, ctB64] = payload.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf8");
}

// --- HANDLER ---
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    initFirebaseAdmin();
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Falta userId" });
    }

    // 📥 Recuperar claves desde binanceSecrets (seguro)
    const doc = await admin.firestore().collection("binanceSecrets").doc(userId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "No se encontraron claves Binance" });
    }

    const { apiKey, apiSecretEncrypted, connectedAt } = doc.data();
    if (!apiKey || !apiSecretEncrypted) {
      return res.status(400).json({ error: "Claves incompletas" });
    }

    const apiSecret = decryptGCM(apiSecretEncrypted);

    // usar la fecha de conexión como punto de inicio
    const connectedAtTs = connectedAt?._seconds ? connectedAt._seconds * 1000 : Date.now();
    const timestamp = Date.now();

    const query = `timestamp=${timestamp}&startTime=${connectedAtTs}`;
    const signature = signRequest(query, apiSecret);

    const url = `https://api.binance.com/sapi/v1/tax/userTrades?${query}&signature=${signature}`;

    // ✅ Método GET, no POST
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": apiKey },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("❌ Error Binance Tax API:", resp.status, text);
      return res.status(500).json({ error: `Binance error ${resp.status}`, details: text });
    }

    const data = await resp.json();
    console.log("📥 Binance Tax data:", data);

    if (!data || !data.data) {
      return res.status(500).json({ error: "No se recibieron datos válidos de Binance", details: data });
    }

    // 🔥 Guardar operaciones en Firestore
    const batch = admin.firestore().batch();
    const opsRef = admin.firestore().collection("users").doc(userId).collection("operations");

    data.data.forEach((op) => {
      const docId = op.orderId?.toString() || op.tradeId?.toString() || crypto.randomBytes(8).toString("hex");
      const ref = opsRef.doc(docId);
      batch.set(
        ref,
        {
          source: "binance-tax",
          raw: op,
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    if (data.data.length > 0) {
      await batch.commit();
    }

    return res.status(200).json({
      ok: true,
      operationsSaved: data.data.length,
      connectedAt: connectedAtTs,
    });
  } catch (err) {
    console.error("💥 Error en sync-binance:", err);
    return res.status(500).json({ error: err.message });
  }
}