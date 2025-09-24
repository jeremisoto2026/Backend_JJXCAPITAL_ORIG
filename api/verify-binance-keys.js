// api/verify-binance-keys.js
import crypto from "crypto";

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
    const { userId, apiKey, apiSecret } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: "Faltan parámetros (apiKey, apiSecret)" });
    }

    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");

    const url = `https://api.binance.com/sapi/v1/account/status?${queryString}&signature=${signature}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
    });

    const data = await resp.json();

    if (resp.ok) {
      return res.status(200).json({ ok: true, message: "Claves válidas" });
    } else {
      return res.status(resp.status).json({ ok: false, error: data });
    }
  } catch (err) {
    console.error("Error en verify-binance-keys:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}