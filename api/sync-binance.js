// api/sync-binance.js
import crypto from "crypto";
import admin from "firebase-admin";

function initFirebaseAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

function signRequest(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

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

    // 🔑 Recuperar claves desde Firestore
    const doc = await admin.firestore().collection("binanceKeys").doc(userId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "No se encontraron claves Binance" });
    }

    const { apiKey, apiSecret, connectedAt } = doc.data();
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: "Claves incompletas" });
    }

    // Tomar solo los trades desde la fecha en que el usuario conectó su cuenta
    const connectedAtTs = connectedAt?._seconds ? connectedAt._seconds * 1000 : Date.now();

    const timestamp = Date.now();

    const query = `timestamp=${timestamp}&startTime=${connectedAtTs}`;
    const signature = signRequest(query, apiSecret);

    const url = `https://api.binance.com/sapi/v1/tax/userTrades?${query}&signature=${signature}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
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
      const ref = opsRef.doc(op.id.toString());
      batch.set(ref, { type: "binance-tax", ...op }, { merge: true });
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