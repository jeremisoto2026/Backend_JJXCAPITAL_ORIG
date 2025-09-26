import axios from "axios";
import crypto from "crypto";
import { db } from "../firebase.js"; // tu inicialización de Firebase Admin

const BINANCE_BASE_URL = process.env.BINANCE_BASE_URL || "https://api.binance.com";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text) {
  const [ivHex, encrypted] = text.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Guardar claves + fecha
export const connectBinance = async (req, res) => {
  try {
    const { uid, apiKey, apiSecret } = req.body;

    if (!uid || !apiKey || !apiSecret) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    await db.collection("binanceKeys").doc(uid).set({
      apiKey: encrypt(apiKey),
      apiSecret: encrypt(apiSecret),
      connectedAt: Date.now(),
    });

    return res.json({ success: true, message: "Claves guardadas y conexión establecida" });
  } catch (err) {
    console.error("Error connectBinance:", err);
    return res.status(500).json({ error: "Error conectando Binance" });
  }
};

// Traer órdenes P2P desde la fecha de conexión
export const syncBinanceP2P = async (req, res) => {
  try {
    const { uid } = req.body;

    const doc = await db.collection("binanceKeys").doc(uid).get();
    if (!doc.exists) return res.status(404).json({ error: "No se encontraron claves" });

    const { apiKey, apiSecret, connectedAt } = doc.data();

    const decryptedApiKey = decrypt(apiKey);
    const decryptedApiSecret = decrypt(apiSecret);

    const timestamp = Date.now();

    // firma
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto
      .createHmac("sha256", decryptedApiSecret)
      .update(queryString)
      .digest("hex");

    const url = `${BINANCE_BASE_URL}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${queryString}&signature=${signature}`;

    const response = await axios.get(url, {
      headers: { "X-MBX-APIKEY": decryptedApiKey },
    });

    // Filtrar solo las órdenes desde la conexión
    const orders = response.data.data.filter(
      (o) => o.createTime >= connectedAt
    );

    // Guardar en Firebase
    for (const order of orders) {
      await db
        .collection("binanceOrders")
        .doc(order.orderNumber.toString())
        .set(order, { merge: true });
    }

    return res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error("Error syncBinanceP2P:", err.response?.data || err.message);
    return res.status(500).json({ error: "Error sincronizando órdenes" });
  }
};