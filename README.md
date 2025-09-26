# Backend JJXCAPITAL

Endpoints:
- POST /api/verify-binance-keys  -> { apiKey, apiSecret }  => valida claves (no guarda)
- POST /api/save-binance-keys    -> { userId, apiKey, apiSecret } => guarda encrypted
- POST /api/sync-binance-p2p     -> { userId } => sincroniza órdenes y guarda en Firestore

Env vars
- FIREBASE_SERVICE_ACCOUNT (JSON string) OR FIREBASE_SERVICE_ACCOUNT_PATH
- BACKEND_SECRET_HEX (64 hex chars)
- BINANCE_BASE_URL (opcional)

Deploy:
- Subir repo a GitHub, conectar con Vercel, agregar env vars en Vercel dashboard.

Seguridad:
- NUNCA subir service account ni BACKEND_SECRET_HEX al repo. Usar Vercel Secrets.