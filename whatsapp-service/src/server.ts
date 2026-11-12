import express from "express";
import QRCode from "qrcode";
import { config } from "./config";
import { whatsapp } from "./whatsapp";
import { sendOrderMessage, SendError } from "./sender";
import { registerTestRoutes } from "./test-ui";

const app = express();

// ---- auth middleware -------------------------------------------------------

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const provided =
    req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? req.header("x-api-key");
  if (!provided || provided !== config.apiKey) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// ---- routes ----------------------------------------------------------------

app.use(express.json({ limit: "16kb" }));
registerTestRoutes(app, requireApiKey); // local testing UI (DISABLED unless ENABLE_TEST_UI=1; sends require the API key)

/** Liveness probe: process is up. Unauthenticated. */
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/** WhatsApp connection state. Unauthenticated, no sensitive data.
 *  loggedInJid is included so the Next.js proxy can show the linked phone
 *  number from this single canonical status endpoint. */
app.get("/status", (_req, res) => {
  const s = whatsapp.getStatus();
  res.json({
    ok: true,
    state: s.state,
    connected: s.connected,
    hasSession: s.hasSession,
    loggedInJid: s.loggedInJid,
    reconnectAttempts: s.reconnectAttempts,
    lastConnectedAt: s.lastConnectedAt,
    lastDisconnectAt: s.lastDisconnectAt,
    lastDisconnectReason: s.lastDisconnectReason,
  });
});

/** Current QR code (as data URL) for login. Requires API key. */
app.get("/qr", requireApiKey, async (_req, res) => {
  const qr = whatsapp.getQr();
  if (!qr) {
    const s = whatsapp.getStatus();
    return res.status(404).json({
      ok: false,
      error: s.connected
        ? "Already connected, no QR needed."
        : "No QR available yet. WhatsApp still connecting — retry shortly.",
    });
  }
  try {
    const dataUrl = await QRCode.toDataURL(qr);
    res.json({ ok: true, qrDataUrl: dataUrl, expiresIn: "QR rotates every ~20s; refetch." });
  } catch {
    res.json({ ok: true, qrString: qr });
  }
});

/** Explicit logout/unlink of the linked WhatsApp account. Requires API key.
 *  Properly logs the session out with WhatsApp, clears the stored
 *  credentials (the previous account can never auto-reconnect) and starts a
 *  fresh connection that emits a new QR for the next account. */
app.post("/logout", requireApiKey, async (_req, res) => {
  try {
    await whatsapp.logout();
    res.json({ ok: true, state: whatsapp.getStatus().state });
  } catch {
    res.status(500).json({ ok: false, error: "LOGOUT_FAILED" });
  }
});

/** Send one transactional message. Requires API key + idempotency key. */
app.post("/send-message", requireApiKey, async (req, res) => {
  const { phone, message, idempotencyKey } = req.body ?? {};
  if (typeof phone !== "string" || typeof message !== "string") {
    return res.status(400).json({ ok: false, error: "phone (string) and message (string) required." });
  }
  if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
    return res.status(400).json({ ok: false, error: "idempotencyKey must be a string." });
  }
  try {
    const result = await sendOrderMessage({ phone, message, idempotencyKey });
    res.json({ ok: result.delivered, ...result });
  } catch (err) {
    if (err instanceof SendError) {
      const status = err.code === "INVALID_PHONE" || err.code === "INVALID_MESSAGE" ? 400 : 503;
      return res.status(status).json({ ok: false, error: err.code, detail: err.message });
    }
    res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
});

// ---- boot ------------------------------------------------------------------

function main() {
  void whatsapp.start();

  whatsapp.on("qr", () => {
    console.log("[whatsapp] New QR available: open http://localhost:%d/qr or scan the terminal.", config.port);
  });
  whatsapp.on("state", (state: string) => {
    console.log(`[whatsapp] state: ${state}`);
  });

  app.listen(config.port, config.host, () => {
    console.log(`[server] listening on http://${config.host}:${config.port}`);
  });
}

main();
