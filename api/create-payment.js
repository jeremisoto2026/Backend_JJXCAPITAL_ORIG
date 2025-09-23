// api/create-payment.js
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

function findUrlInObj(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
    if (typeof v === "string" && (v.includes("checkout") || v.includes("pay") || v.includes("url"))) return v;
    if (typeof v === "object") {
      const sub = findUrlInObj(v);
      if (sub) return sub;
    }
  }
  return null;
}

export default async function handler(req, res) {
  // ✅ CORS abierto a cualquier dominio
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, BinancePay-Signature, BinancePay-Timestamp, BinancePay-Nonce");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    // 👀 Log para verificar variables de entorno (sin exponer secretos)
    console.log("🌍 Variables de entorno disponibles:", {
      BINANCE_API_KEY: process.env.BINANCE_API_KEY ? "✅ definida" : "❌ no definida",
      BINANCE_API_SECRET: process.env.BINANCE_API_SECRET ? "✅ definida" : "❌ no definida",
      FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT ? "✅ definida" : "❌ no definida",
    });

    initFirebaseAdmin();

    const { userId, amount, plan } = req.body;
    console.log("📩 Body recibido en /api/create-payment:", { userId, amount, plan });

    let totalAmount = amount;
    if (!totalAmount) {
      if (plan === "monthly") totalAmount = 13;
      else if (plan === "annual") totalAmount = 125;
    }

    if (!userId || !totalAmount) {
      return res.status(400).json({ error: "Faltan parámetros: userId o amount/plan" });
    }

    const merchantTradeNo = `${userId}-${Date.now()}`;
    const payload = {
      merchantTradeNo,
      totalFee: totalAmount.toString(),
      currency: "USDT",
      productType: "CASH",
      productName: plan === "annual" ? "Plan Premium Anual" : "Plan Premium Mensual",
    };

    const jsonPayload = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString("hex");
    const signaturePayload = `${timestamp}\n${nonce}\n${jsonPayload}\n`;
    const signature = crypto
      .createHmac("sha512", process.env.BINANCE_API_SECRET)
      .update(signaturePayload)
      .digest("hex");

    const response = await fetch("https://bpay.binanceapi.com/binancepay/openapi/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BinancePay-Timestamp": timestamp,
        "BinancePay-Nonce": nonce,
        "BinancePay-Certificate-SN": process.env.BINANCE_API_KEY,
        "BinancePay-Signature": signature,
      },
      body: jsonPayload,
    });

    const data = await response.json();
    console.log("📤 Respuesta Binance:", JSON.stringify(data));

    try {
      await admin.firestore().collection("payments").doc(merchantTradeNo).set({
        userId,
        amount: totalAmount,
        plan: plan || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: response.ok ? "created" : "error",
        binanceRaw: data,
      });
    } catch (e) {
      console.error("⚠️ Error guardando payment en Firestore:", e);
    }

    const checkoutUrl = findUrlInObj(data) || null;
    return res.status(response.ok ? 200 : 500).json({ ok: response.ok, checkoutUrl, binance: data });
  } catch (error) {
    console.error("💥 Error en create-payment:", error);
    return res.status(500).json({ error: "Error creando el pago", details: error.message });
  }
}