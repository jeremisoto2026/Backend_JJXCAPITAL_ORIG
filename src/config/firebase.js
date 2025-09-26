import admin from "firebase-admin";

let app;

// Evita inicializar Firebase más de una vez (importante en Vercel)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  app = admin.app();
}

const db = admin.firestore();

export { db, app };