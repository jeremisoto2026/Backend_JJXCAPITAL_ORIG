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

    // Guardamos en Firestore bajo binanceKeys/{userId}
    await admin.firestore().collection("binanceKeys").doc(userId).set({
      apiKey,
      apiSecret,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ ok: true, message: "Claves guardadas correctamente." });
  } catch (err) {
    console.error("💥 Error en save-binance-keys:", err);
    return res.status(500).json({ error: "Error guardando las claves", details: err.message });
  }
}
