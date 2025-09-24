// api/verify-binance-keys.js
import crypto from "crypto";

function signRequest(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { apiKey, apiSecret } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    // 🔗 Usamos un endpoint simple para probar (Tax API → solo lectura)
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&limit=1`;
    const signature = signRequest(queryString, apiSecret);

    const url = `https://api.binance.com/sapi/v1/tax/userTrade?${queryString}&signature=${signature}`;

    const resp = await fetch(url, {
      method: "GET", // ✅ este endpoint soporta GET
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
    });

    const text = await resp.text();
    console.log("📡 Binance verify response:", resp.status, text);

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Claves inválidas o permisos insuficientes",
        details: text,
      });
    }

    return res.status(200).json({ ok: true, message: "✅ Claves válidas" });
  } catch (err) {
    console.error("💥 Error verificando claves:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}