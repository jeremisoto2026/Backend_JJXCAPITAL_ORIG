// api/verify-binance-keys.js
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { apiKey, apiSecret } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    // Endpoint de prueba en Binance (status de cuenta)
    const endpoint = "/api/v3/account";
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;

    // Firmamos con la clave secreta del usuario
    const signature = crypto
      .createHmac("sha256", apiSecret)
      .update(query)
      .digest("hex");

    const url = `https://api.binance.com${endpoint}?${query}&signature=${signature}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": apiKey },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(400).json({
        ok: false,
        error: "Error verificando claves",
        details: errorText,
      });
    }

    // ✅ Claves correctas
    return res.status(200).json({ ok: true, message: "Conexión exitosa con Binance" });
  } catch (err) {
    console.error("Error en verify-binance-keys:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}