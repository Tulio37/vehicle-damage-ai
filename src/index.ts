import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import * as path from 'path';
import { connectDatabase } from './config/database';
import occurrenceRoutes from './routes/occurrence.routes';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Log all requests
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

// Bypass localtunnel browser confirmation page
app.use((_req, res, next) => {
  res.setHeader('bypass-tunnel-reminder', 'true');
  next();
});

// Static files (media uploads)
app.use('/media', express.static(path.join(process.cwd(), 'uploads')));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/v1/occurrences', occurrenceRoutes);

// QR code page for Expo Go
const EXPO_TUNNEL_URL = 'exp://sdxroje-anonymous-8081.exp.direct';
app.get('/qr', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Expo QR</title>
<style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#000;color:#fff}
h2{margin-bottom:8px}p{color:#aaa;margin:4px 0 20px;font-size:14px;text-align:center}
#qr{background:#fff;padding:16px;border-radius:12px}
.url{margin-top:16px;background:#1a1a1a;padding:12px 16px;border-radius:8px;font-family:monospace;font-size:12px;color:#4fc;word-break:break-all;max-width:320px;text-align:center}
.note{margin-top:10px;color:#4fc;font-size:13px;font-weight:bold}
a{margin-top:16px;background:#4CAF50;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px}
</style></head>
<body>
<h2>📱 Abrir no Expo Go</h2>
<p>Escaneie com a câmera do iPhone<br>ou toque no botão abaixo</p>
<div id="qr"></div>
<div class="url">${EXPO_TUNNEL_URL}</div>
<div class="note">✅ Funciona em Wi-Fi e 5G</div>
<a href="${EXPO_TUNNEL_URL}">Abrir no Expo Go</a>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>new QRCode(document.getElementById("qr"),{text:"${EXPO_TUNNEL_URL}",width:240,height:240,colorDark:"#000",colorLight:"#fff"})</script>
</body></html>`);
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'vehicle-damage-ai',
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function main() {
  try {
    await connectDatabase();
    app.listen(PORT, () => {
      console.log(`[Server] Vehicle Damage AI rodando em http://localhost:${PORT}`);
      console.log(`[Server] Health check: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('[Server] Falha ao iniciar:', err);
    process.exit(1);
  }
}

main();
