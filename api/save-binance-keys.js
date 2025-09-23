// api/save-binance-keys.js
import admin from "firebase-admin";

function initFirebaseAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

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

    await admin.firestore().collection("binanceKeys").doc(userId).set({
      apiKey,
      apiSecret,
      updatedAt: new Date(),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("💥 Error guardando claves:", err);
    return res.status(500).json({ error: err.message });
  }
}