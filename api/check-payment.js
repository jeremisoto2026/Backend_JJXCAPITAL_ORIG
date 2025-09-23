// api/check-payment.js
import admin from "firebase-admin";

function initFirebaseAdmin() {
  if (!admin.apps.length) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined;

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  initFirebaseAdmin();

  const paymentId = req.query.paymentId;
  if (!paymentId) return res.status(400).json({ message: "paymentId is required" });

  try {
    const snap = await admin.firestore().collection("payments").doc(paymentId).get();
    if (!snap.exists) return res.status(404).json({ message: "Payment not found" });

    const data = snap.data();
    res.status(200).json({ status: data.status || "pending", data });
  } catch (err) {
    console.error("check-payment error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
