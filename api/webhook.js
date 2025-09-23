// api/webhook.js
import crypto from "crypto";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

export default async function handler(req, res) {
  // Binance envía POST; permitir preflight si lo necesita
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, BinancePay-Signature, BinancePay-Timestamp, BinancePay-Nonce");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const body = JSON.stringify(req.body);
    const signature = req.headers["binancepay-signature"];
    const nonce = req.headers["binancepay-nonce"];
    const timestamp = req.headers["binancepay-timestamp"];

    const payload = `${timestamp}\n${nonce}\n${body}\n`;
    const expectedSignature = crypto.createHmac("sha512", process.env.BINANCE_API_SECRET).update(payload).digest("hex");

    if (expectedSignature !== signature) {
      console.warn("Firma inválida en webhook. Esperado:", expectedSignature, "Recibido:", signature);
      return res.status(400).json({ error: "Firma inválida" });
    }

    const { bizStatus, bizId, data } = req.body || {};
    // merchantTradeNo lo mandamos en create-payment como merchantTradeNo
    const merchantTradeNo = data?.merchantTradeNo || data?.merchant_trade_no || (data && data.merchantTradeNo) || null;

    // Si el pago fue exitoso, actualizamos Firestore y el usuario
    if (bizStatus === "PAY_SUCCESS") {
      const userId = merchantTradeNo ? merchantTradeNo.split("-")[0] : null;
      if (merchantTradeNo) {
        await admin.firestore().collection("payments").doc(merchantTradeNo).update({
          status: "paid",
          binanceBizId: bizId || null,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          webhookRaw: req.body
        }).catch((e)=>console.error("update payment error:", e));
      }
      if (userId) {
        await admin.firestore().collection("users").doc(userId).update({
          plan: "premium",
          premiumSince: admin.firestore.FieldValue.serverTimestamp()
        }).catch((e)=>console.error("update user error:", e));
      }
      return res.status(200).json({ message: "Usuario actualizado a Premium" });
    }

    return res.status(200).json({ message: "Notificación recibida" });
  } catch (error) {
    console.error("Error en webhook:", error);
    return res.status(500).json({ error: "Error interno en webhook" });
  }
}
