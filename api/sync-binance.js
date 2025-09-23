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

    if (!userId) return res.status(400).json({ error: "Falta userId" });

    // 1. Recuperamos apiKey y apiSecret de Firestore
    const doc = await admin.firestore().collection("binanceKeys").doc(userId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "No se encontraron claves Binance" });
    }
    const { apiKey, apiSecret } = doc.data();

    // 2. Firmamos petición
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = signRequest(queryString, apiSecret);

    // 3. Llamamos Binance Deposit History
    const url = `https://api.binance.com/sapi/v1/capital/deposit/hisrec?${queryString}&signature=${signature}`;
    const resp = await fetch(url, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    const deposits = await resp.json();

    // 4. Llamamos Binance Withdraw History
    const url2 = `https://api.binance.com/sapi/v1/capital/withdraw/history?${queryString}&signature=${signature}`;
    const resp2 = await fetch(url2, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    const withdrawals = await resp2.json();

    // 5. Guardamos en Firestore en /users/{userId}/operations
    const batch = admin.firestore().batch();
    const opsRef = admin.firestore().collection("users").doc(userId).collection("operations");

    deposits.forEach(dep => {
      const ref = opsRef.doc(dep.txId.toString());
      batch.set(ref, { type: "deposit", ...dep }, { merge: true });
    });

    withdrawals.forEach(wd => {
      const ref = opsRef.doc(wd.id.toString());
      batch.set(ref, { type: "withdraw", ...wd }, { merge: true });
    });

    await batch.commit();

    return res.status(200).json({
      ok: true,
      deposits,
      withdrawals,
    });
  } catch (err) {
    console.error("💥 Error sync-binance:", err);
    return res.status(500).json({ error: err.message });
  }
}
