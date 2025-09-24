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

    // 🔑 Recuperar claves y fecha de conexión desde Firestore
    const doc = await admin.firestore().collection("binanceKeys").doc(userId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "No se encontraron claves Binance" });
    }

    const { apiKey, apiSecret, connectedAt } = doc.data();
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: "Claves incompletas" });
    }

    // Si no hay fecha de conexión, asumimos "ahora"
    const connectedAtTs = connectedAt?._seconds ? connectedAt._seconds * 1000 : Date.now();

    // 🔗 Endpoint P2P user trades (POST requerido)
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&limit=50`;
    const signature = signRequest(queryString, apiSecret);

    const url = `https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${queryString}&signature=${signature}`;

    const resp = await fetch(url, {
      method: "POST", // 🔥 Importante: debe ser POST
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
    console.log("📥 Binance P2P data:", data);

    if (!data || !data.data) {
      return res.status(500).json({ error: "No se recibieron datos válidos de Binance", details: data });
    }

    // 🔥 Filtrar solo operaciones posteriores a connectedAt
    const newOps = data.data.filter(op => {
      const orderTime = op.createTime || op.orderTime || 0;
      return orderTime >= connectedAtTs;
    });

    // Guardar solo operaciones nuevas
    const batch = admin.firestore().batch();
    const opsRef = admin.firestore().collection("users").doc(userId).collection("operations");

    newOps.forEach((op) => {
      const ref = opsRef.doc(op.orderNumber.toString());
      batch.set(ref, { type: "p2p", ...op }, { merge: true });
    });

    if (newOps.length > 0) {
      await batch.commit();
    }

    return res.status(200).json({
      ok: true,
      operationsSaved: newOps.length,
      filteredFrom: newOps.length,
      connectedAt: connectedAtTs,
    });
  } catch (err) {
    console.error("💥 Error en sync-binance-p2p:", err);
    return res.status(500).json({ error: err.message });
  }
}