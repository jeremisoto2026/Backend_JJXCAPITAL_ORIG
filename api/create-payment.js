// api/create-payment.js
import crypto from "crypto";
import admin from "firebase-admin";

function initFirebaseAdmin() {
  if (!admin.apps.length) {
    try {
      console.log("🔑 Inicializando Firebase Admin...");
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

      console.log("✅ project_id:", serviceAccount.project_id);
      console.log("✅ client_email:", serviceAccount.client_email);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } catch (e) {
      console.error("❌ Error inicializando Firebase Admin:", e);
      throw e;
    }
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
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, BinancePay-Signature, BinancePay-Timestamp, BinancePay-Nonce"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    initFirebaseAdmin();

    const { userId, amount, plan } = req.body;
    console.log("📩 Body recibido:", { userId, amount, plan });

    let totalAmount = amount;
    if (!totalAmount) {
      if (plan === "monthly") totalAmount = 13;
      else if (plan === "annual") totalAmount = 125;
    }

    if (!userId || !totalAmount) {
      console.warn("⚠️ Faltan parámetros:", { userId, totalAmount });
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

    console.log("🛠 Payload Binance:", payload);

    const jsonPayload = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString("hex");
    const signaturePayload = `${timestamp}\n${nonce}\n${jsonPayload}\n`;
    const signature = crypto
      .createHmac("sha512", process.env.BINANCE_API_SECRET)
      .update(signaturePayload)
      .digest("hex");

    console.log("🔐 Headers Binance:", {
      "BinancePay-Timestamp": timestamp,
      "BinancePay-Nonce": nonce,
      "BinancePay-Certificate-SN": process.env.BINANCE_API_KEY?.slice(0, 6) + "...",
      "BinancePay-Signature": signature?.slice(0, 12) + "...",
    });

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
    console.log("📤 Respuesta Binance:", JSON.stringify(data, null, 2));

    try {
      await admin.firestore().collection("payments").doc(merchantTradeNo).set({
        userId,
        amount: totalAmount,
        plan: plan || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: response.ok ? "created" : "error",
        binanceRaw: data,
      });
      console.log("💾 Registro guardado en Firestore:", merchantTradeNo);
    } catch (e) {
      console.error("❌ Error guardando en Firestore:", e);
    }

    const checkoutUrl = findUrlInObj(data) || null;
    console.log("🔎 checkoutUrl encontrada:", checkoutUrl);

    return res.status(response.ok ? 200 : 500).json({ ok: response.ok, checkoutUrl, binance: data });
  } catch (error) {
    console.error("❌ Error en create-payment:", error);
    return res.status(500).json({ error: "Error creando el pago", details: error.message });
  }
}