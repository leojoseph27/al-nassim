import crypto from "crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { whatsapp, maskPhone } from "./whatsapp";
import { sendOrderMessage, normalizePhone, SendError } from "./sender";
import { config } from "./config";

/**
 * Local development/testing interface only — NOT part of the public API
 * and NOT for production/AL-Nassim integration.
 *
 * SAFEGUARDS (added after the unsolicited-greeting incident):
 *  - The whole test UI is registered ONLY when ENABLE_TEST_UI=1 is set in
 *    the service environment. Default is OFF: a plain `npm start` exposes
 *    no test routes at all, so the service can never send a test greeting
 *    unless testing is explicitly switched on.
 *  - Even when enabled, SCHEDULING a test send requires the API key
 *    (X-API-Key / Bearer), the same secret that protects /send-message —
 *    previously /test/schedule was unauthenticated and could send a
 *    greeting to ANY number from any localhost tab.
 * The API key never reaches the browser: these routes call the same
 * sendOrderMessage() path as /send-message, injecting the key server-side.
 * Exactly one WhatsApp connection (whatsapp.ts) is used.
 */

const TEST_MESSAGE = "hello how are you";
const DELAY_MS = 30_000;

interface ScheduledTest {
  id: string;
  phone: string; // normalized digits
  status: "countdown" | "sending" | "sent" | "failed";
  scheduledAt: number;
  sentAt?: number;
  error?: string;
  messageId?: string;
  timer: NodeJS.Timeout;
}

let active: ScheduledTest | null = null;

function secondsLeft(t: ScheduledTest): number {
  const remaining = DELAY_MS - (Date.now() - t.scheduledAt);
  return Math.max(0, Math.ceil(remaining / 1000));
}

export function registerTestRoutes(
  app: express.Express,
  requireApiKey: (req: Request, res: Response, next: NextFunction) => void,
): void {
  // Gate: no test routes at all unless explicitly enabled in the env.
  if (process.env.ENABLE_TEST_UI !== "1") {
    console.log("[test] test UI disabled (set ENABLE_TEST_UI=1 to enable).");
    return;
  }
  console.log("[test] test UI ENABLED — /test routes require the API key to send.");

  // ---- connection status + QR ----------------------------------------------

  app.get("/test/connection", (_req, res) => {
    const s = whatsapp.getStatus();
    const qr = whatsapp.getQr();
    if (qr && s.state === "awaiting_qr") {
      import("qrcode").then(({ default: QRCode }) =>
        QRCode.toDataURL(qr).then((qrDataUrl) =>
          res.json({
            state: s.state,
            connected: s.connected,
            hasSession: s.hasSession,
            loggedInJid: s.loggedInJid,
            qrDataUrl,
          }),
        ),
      );
      return;
    }
    res.json({
      state: s.state,
      connected: s.connected,
      hasSession: s.hasSession,
      loggedInJid: s.loggedInJid,
      qrDataUrl: null,
    });
  });

  app.get("/test/qr", requireApiKey, async (_req, res) => {
    const qr = whatsapp.getQr();
    if (!qr) {
      return res.json({ qrDataUrl: null, note: "No QR right now (connected or still connecting)." });
    }
    const { default: QRCode } = await import("qrcode");
    res.json({ qrDataUrl: await QRCode.toDataURL(qr) });
  });

  // ---- schedule the 30-second test ------------------------------------------

  // API key required: scheduling a test send must never be unauthenticated.
  app.post("/test/schedule", requireApiKey, (req, res) => {
    const raw = (req.body ?? {}).phone;
    if (typeof raw !== "string") {
      return res.status(400).json({ ok: false, error: "phone (string) is required." });
    }
    const phone = normalizePhone(raw);
    if (!phone) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid phone number. Use international format, e.g. +9665xxxxxxxx" });
    }
    if (active && (active.status === "countdown" || active.status === "sending")) {
      return res.status(409).json({
        ok: false,
        error:
          active.status === "countdown"
            ? `A test is already counting down (${secondsLeft(active)}s left). Wait for it to finish.`
            : "A test message is being sent right now. Wait a moment.",
        activeTestId: active.id,
        secondsLeft: active.status === "countdown" ? secondsLeft(active) : 0,
      });
    }

    const id = crypto.randomUUID();
    const test: ScheduledTest = {
      id,
      phone,
      status: "countdown",
      scheduledAt: Date.now(),
      timer: setTimeout(() => {
        void runSend(test);
      }, DELAY_MS),
    };
    active = test;
    console.log(`[test] scheduled: -> ${maskPhone(phone)} in 30s`);
    res.status(202).json({ ok: true, testId: id, scheduledAt: test.scheduledAt, delayMs: DELAY_MS });
  });

  app.get("/test/schedule/:id", requireApiKey, (req, res) => {
    if (!active || active.id !== req.params.id) {
      return res.status(404).json({ ok: false, error: "Unknown test id." });
    }
    const t = active;
    res.json({
      ok: true,
      testId: t.id,
      status: t.status,
      secondsLeft: t.status === "countdown" ? secondsLeft(t) : 0,
      sentAt: t.sentAt,
      messageId: t.messageId,
      error: t.error,
      maskedPhone: maskPhone(t.phone),
    });
  });

  // ---- the page itself -------------------------------------------------------

  app.get("/test", (_req, res) => {
    res.type("html").send(page());
  });
}

async function runSend(t: ScheduledTest): Promise<void> {
  t.status = "sending";
  console.log(`[test] sending -> ${maskPhone(t.phone)}`);
  try {
    const result = await sendOrderMessage({
      phone: t.phone,
      message: TEST_MESSAGE,
      idempotencyKey: `test-${crypto.randomUUID()}`,
    });
    t.status = result.delivered ? "sent" : "failed";
    t.sentAt = Date.now();
    t.messageId = result.messageId;
    if (!result.delivered) t.error = "WhatsApp did not confirm delivery of the message.";
    console.log(`[test] result: ${t.status}`);
  } catch (err) {
    t.status = "failed";
    t.sentAt = Date.now();
    t.error =
      err instanceof SendError
        ? `${err.code}: ${err.message}`
        : `Unexpected error: ${(err as Error).message}`;
    console.log(`[test] result: failed (${t.error})`);
  }
}

function page(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Service — Local Test</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; background:#111827; color:#e5e7eb;
         max-width: 560px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.25rem; }
  section { background:#1f2937; border:1px solid #374151; border-radius:12px; padding:20px; margin-bottom:20px; }
  .badge { display:inline-block; padding:4px 12px; border-radius:999px; font-weight:600; font-size:.85rem; }
  .b-disconnected{background:#7f1d1d;} .b-connecting{background:#92400e;} .b-awaiting_qr{background:#1e3a8a;} .b-open{background:#14532d;}
  #qrbox { text-align:center; margin-top:14px; }
  #qrbox img { width:260px; height:260px; border-radius:8px; background:#fff; }
  .row { display:flex; gap:10px; }
  input { flex:1; padding:10px 12px; border-radius:8px; border:1px solid #4b5563; background:#111827; color:#e5e7eb; font-size:1rem; }
  button { padding:10px 18px; border-radius:8px; border:none; background:#059669; color:#fff; font-weight:600; cursor:pointer; font-size:1rem; }
  button:disabled { background:#374151; cursor:not-allowed; }
  button.secondary { background:#4b5563; }
  #result { margin-top:14px; padding:12px; border-radius:8px; display:none; white-space:pre-wrap; }
  .ok { background:#14532d; } .err { background:#7f1d1d; } .info { background:#1e3a8a; }
  .countdown { font-size:2.2rem; font-weight:700; text-align:center; margin:12px 0; color:#fbbf24; }
  .muted { color:#9ca3af; font-size:.85rem; }
  code { background:#111827; padding:2px 6px; border-radius:4px; }
</style>
</head>
<body>
<h1>WhatsApp Order Service — Local Test</h1>

<section>
  <h2>WhatsApp connection</h2>
  <p>Status: <span id="state" class="badge b-disconnected">checking…</span></p>
  <p id="account" class="muted"></p>
  <div id="qrbox" style="display:none">
    <img id="qrimg" alt="WhatsApp login QR code">
    <p class="muted">WhatsApp &rarr; Settings &rarr; Linked devices &rarr; Link a device &rarr; scan this.</p>
    <button id="refreshqr" class="secondary">Refresh QR</button>
  </div>
</section>

<section>
  <h2>Customer message test (30-second delay)</h2>
  <div class="row">
    <input id="phone" placeholder="+9665xxxxxxxx (customer number, incl. country code)">
    <button id="send">SEND WHATSAPP</button>
  </div>
  <div id="result"></div>
  <div id="countdown" class="countdown" style="display:none"></div>
  <p class="muted">Clicking SEND WHATSAPP only <b>schedules</b> the test. After exactly 30 seconds the
  message <code>hello how are you</code> is sent automatically from the connected account to the number above. No manual sending needed.</p>
</section>

<script>
const stateEl = document.getElementById('state');
const accountEl = document.getElementById('account');
const qrbox = document.getElementById('qrbox');
const qrimg = document.getElementById('qrimg');
const sendBtn = document.getElementById('send');
const resultEl = document.getElementById('result');
const countdownEl = document.getElementById('countdown');
let testId = null;
let localDeadline = null;

function showResult(text, cls) {
  resultEl.style.display = 'block';
  resultEl.className = cls;
  resultEl.textContent = text;
}

async function pollConnection() {
  try {
    const r = await fetch('/test/connection');
    const d = await r.json();
    stateEl.textContent = {disconnected:'Disconnected', connecting:'Connecting…', awaiting_qr:'Awaiting QR scan', open:'Connected'}[d.state] || d.state;
    stateEl.className = 'badge b-' + d.state;
    if (d.state === 'open' && d.loggedInJid) {
      accountEl.textContent = 'Connected account: ' + d.loggedInJid.split('@')[0].split(':')[0];
    } else {
      accountEl.textContent = d.hasSession ? 'Saved session found — reconnecting without QR.' : '';
    }
    if (d.qrDataUrl) { qrimg.src = d.qrDataUrl; qrbox.style.display = 'block'; }
    else if (d.state !== 'awaiting_qr') { qrbox.style.display = 'none'; }
  } catch { stateEl.textContent = 'Backend unreachable'; }
}

async function pollTest() {
  if (!testId) return;
  try {
    const r = await fetch('/test/schedule/' + testId);
    if (!r.ok) return;
    const d = await r.json();
    if (d.status === 'countdown') {
      countdownEl.style.display = 'block';
      countdownEl.textContent = d.secondsLeft;
      showResult('⏳ Test scheduled. Message will be sent automatically in ' + d.secondsLeft + ' seconds. Do not close this page.', 'info');
    } else if (d.status === 'sending') {
      countdownEl.style.display = 'none';
      showResult('📨 Sending message…', 'info');
    } else if (d.status === 'sent') {
      countdownEl.style.display = 'none';
      showResult('✅ Message sent successfully to ' + d.maskedPhone + ' (id ' + (d.messageId || '?') + '). Check the customer WhatsApp.', 'ok');
      sendBtn.disabled = false; testId = null;
    } else if (d.status === 'failed') {
      countdownEl.style.display = 'none';
      showResult('❌ Sending failed: ' + (d.error || 'unknown error'), 'err');
      sendBtn.disabled = false; testId = null;
    }
  } catch {}
}

document.getElementById('refreshqr').addEventListener('click', async () => {
  const r = await fetch('/test/qr');
  const d = await r.json();
  if (d.qrDataUrl) { qrimg.src = d.qrDataUrl; }
  else { showResult(d.note || 'No QR available.', 'info'); }
});

sendBtn.addEventListener('click', async () => {
  const phone = document.getElementById('phone').value.trim();
  if (!phone) { showResult('Enter the customer phone number first.', 'err'); return; }
  sendBtn.disabled = true;
  showResult('⏳ Scheduling test…', 'info');
  try {
    const r = await fetch('/test/schedule', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phone })
    });
    const d = await r.json();
    if (!r.ok) {
      showResult('❌ Could not schedule: ' + d.error, 'err');
      sendBtn.disabled = false;
      return;
    }
    testId = d.testId;
    localDeadline = Date.now() + d.delayMs;
  } catch (e) {
    showResult('❌ Backend unreachable: ' + e.message, 'err');
    sendBtn.disabled = false;
  }
});

pollConnection();
setInterval(pollConnection, 2000);
setInterval(pollTest, 500);
</script>
</body>
</html>`;
}
