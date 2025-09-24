// api/sync-binance-p2p.js
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
    if (!userId) return res.status(400).json({ error: "Falta userId" });

    // 🔑 Recuperar claves y fecha de conexión
    const doc = await admin.firestore().collection("binanceKeys").doc(userId).get();
    if (!doc.exists) return res.status(404).json({ error: "No se encontraron claves Binance" });
    const { apiKey, apiSecret, connectedAt } = doc.data();

    // 🔗 Endpoint P2P user trades
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&limit=50`;
    const signature = signRequest(queryString, apiSecret);

    const url = `https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${queryString}&signature=${signature}`;
    
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("❌ Error Binance:", resp.status, text);
      return res.status(500).json({ error: `Binance error ${resp.status}`, details: text });
    }

    const data = await resp.json();

    if (!data || !data.data) {
      return res.status(500).json({ error: "No se recibieron datos válidos de Binance", details: data });
    }

    // 🔥 Filtrar operaciones por fecha de conexión
    const connectedDate = connectedAt ? new Date(connectedAt) : null;
    const newOps = connectedDate
      ? data.data.filter(op => new Date(op.createTime) > connectedDate)
      : data.data;

    // Guardar en Firestore solo las nuevas
    const batch = admin.firestore().batch();
    const opsRef = admin.firestore().collection("users").doc(userId).collection("operations");

    newOps.forEach(op => {
      const ref = opsRef.doc(op.orderNumber.toString());
      batch.set(ref, { type: "p2p", ...op }, { merge: true });
    });

    await batch.commit();

    return res.status(200).json({
      ok: true,
      operationsSaved: newOps.length,
      totalFetched: data.data.length,
    });
  } catch (err) {
    console.error("💥 Error en sync-binance-p2p:", err);
    return res.status(500).json({ error: err.message });
  }
}