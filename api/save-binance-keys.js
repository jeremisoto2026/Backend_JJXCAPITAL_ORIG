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
  // 🔐 Configurar CORS (si tu frontend está en otro dominio)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // ✅ Preflight response
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    initFirebaseAdmin();
    const { userId, apiKey, apiSecret } = req.body;

    if (!userId || !apiKey || !apiSecret) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    // 📌 Guardamos claves junto con la fecha de conexión
    await admin.firestore().collection("binanceKeys").doc(userId).set(
      {
        apiKey,
        apiSecret,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(), // ⏰ Usado para sync
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true } // 🔥 para no sobreescribir si reusa el mismo doc
    );

    return res
      .status(200)
      .json({ ok: true, message: "✅ Claves guardadas correctamente" });
  } catch (err) {
    console.error("💥 Error guardando claves:", err);
    return res.status(500).json({ error: err.message });
  }
}