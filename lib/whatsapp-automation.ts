/**
 * WhatsApp automation (Baileys local service) — server-side glue.
 *
 * The Baileys service ("wa.me automation" project) runs as a SEPARATE local
 * process on 127.0.0.1:4000 with its own persistent session. This library is
 * the ONLY way the Next.js app talks to it: the API key never leaves the
 * server, and every policy decision (admin toggle, test-mode recipient,
 * duplicate prevention) is enforced HERE, not in browser JavaScript.
 */
import { prisma } from "@/lib/db";
import { orderShortPath, customerOrderBaseUrl } from "@/lib/order-link";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export const SETTING_KEY = "whatsapp_automation_enabled";
export const TEST_MODE_KEY = "whatsapp_test_mode";

/** TEST MODE is the DEFAULT and must be disabled deliberately by an admin
 *  through the admin Settings tab — real customer delivery is never turned
 *  on automatically. */
export async function isTestModeEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: TEST_MODE_KEY } });
  return row?.value !== "false"; // default: restricted testing
}

export async function setTestModeEnabled(testMode: boolean, actorId: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: TEST_MODE_KEY },
    update: { value: testMode ? "true" : "false" },
    create: { key: TEST_MODE_KEY, value: testMode ? "true" : "false" },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: "WHATSAPP_TEST_MODE_TOGGLE",
      entity: "Setting",
      entityId: TEST_MODE_KEY,
      detail: testMode
        ? "TEST MODE ON — automated messages restricted to testing numbers"
        : "TEST MODE OFF — REAL CUSTOMER DELIVERY ENABLED by administrator",
    },
  });
}

/* ------------------------------------------------------------------ */
/* Central phone-number normalization (single source of truth)          */
/* ------------------------------------------------------------------ */

/**
 * Normalize a customer phone number to E.164 digits (no "+").
 *
 * Checkout already stores "+<dial><national digits>" (checkout.js builds
 * "+" + selectedCountryDial + digits), so the selected country's calling
 * code is preserved — nothing is assumed about Kuwait. Handles: spaces,
 * hyphens, brackets; a leading "00" prefix; and a duplicated dial code
 * (e.g. "+96596566235398" from a full number pasted although the selector
 * already contributed +965 — the duplicate is stripped once, never the
 * whole country code). Returns null when the result is not a valid
 * international phone number.
 */
export function normalizeCustomerPhone(raw: string): string | null {
  const cleaned = String(raw ?? "").trim();
  if (!cleaned) return null;
  const digits = cleaned.replace(/\D/g, "");
  if (!digits) return null;
  const candidates = [digits];
  // Duplicated dial code (paste artifact): "965" + "965 66235398" etc.
  for (const len of [2, 3, 4]) {
    const prefix = digits.slice(0, len);
    if (prefix.length === len && digits.startsWith(prefix + prefix)) {
      candidates.push(digits.slice(len));
    }
  }
  // Leading "00" international prefix.
  if (digits.startsWith("00")) candidates.push(digits.slice(2));
  // A bare national number starting with a trunk "0" (no dial code present):
  // libphonenumber rejects it — drop one leading zero as a last resort.
  if (!cleaned.includes("+") && digits.startsWith("0")) candidates.push(digits.replace(/^0+/, ""));
  for (const cand of candidates) {
    const parsed = parsePhoneNumberFromString("+" + cand);
    if (parsed && parsed.isValid()) return parsed.number.replace(/\D/g, "");
  }
  return null;
}

/**
 * STRICT TEST-MODE ALLOWLIST (server-side only, used while TEST MODE is on).
 *
 * Automated messages may ONLY go to the numbers listed in the
 * WHATSAPP_TEST_RECIPIENT env var (comma-separated). An order whose own
 * customer phone is on the list receives its message on that number; ANY
 * other number is redirected to the FIRST (primary) entry.
 */
export function testRecipients(): string[] {
  return (process.env.WHATSAPP_TEST_RECIPIENT || "96566235398,919567767488")
    .split(",")
    .map((s) => s.replace(/\D/g, ""))
    .filter(Boolean);
}

export function primaryTestRecipient(): string {
  return testRecipients()[0] || "96566235398";
}

const SERVICE_URL = (process.env.WHATSAPP_SERVICE_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");

function serviceConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_SERVICE_URL && process.env.WHATSAPP_API_KEY);
}

function serviceHeaders(): HeadersInit {
  return { "X-API-Key": process.env.WHATSAPP_API_KEY || "" };
}

async function serviceFetch(path: string, init?: RequestInit, timeoutMs = 35000): Promise<{ ok: boolean; status: number; body: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(SERVICE_URL + path, { ...init, headers: { ...(init?.headers || {}), ...(path === "/health" || path.startsWith("/test/") ? {} : serviceHeaders()) }, signal: ctrl.signal, cache: "no-store" });
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Admin toggle (persisted in the Setting table — survives restarts)   */
/* ------------------------------------------------------------------ */

export async function isAutomationEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  return row?.value === "true";
}

export async function setAutomationEnabled(enabled: boolean, actorId: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: enabled ? "true" : "false" },
    create: { key: SETTING_KEY, value: enabled ? "true" : "false" },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: "WHATSAPP_AUTOMATION_TOGGLE",
      entity: "Setting",
      entityId: SETTING_KEY,
      detail: `WhatsApp Message Automation ${enabled ? "ENABLED" : "DISABLED"}`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Service status / QR (proxied to authenticated staff endpoints)      */
/* ------------------------------------------------------------------ */

export type WaServiceStatus = {
  serviceUp: boolean;
  connected: boolean;
  state: string;
  phone: string | null;
};

export async function serviceStatus(): Promise<WaServiceStatus> {
  if (!serviceConfigured()) return { serviceUp: false, connected: false, state: "unconfigured", phone: null };
  try {
    // Canonical /status endpoint of the service (now includes the linked
    // phone via loggedInJid — no test-UI routes involved).
    const r = await serviceFetch("/status", {}, 8000);
    if (!r.ok || !r.body) return { serviceUp: false, connected: false, state: "unreachable", phone: null };
    const jid: string | undefined = r.body.loggedInJid;
    const phone = jid ? jid.split("@")[0].split(":")[0] : null;
    return {
      serviceUp: true,
      connected: Boolean(r.body.connected),
      state: String(r.body.state || "unknown"),
      phone,
    };
  } catch {
    return { serviceUp: false, connected: false, state: "unreachable", phone: null };
  }
}

export async function serviceQr(): Promise<{ ok: boolean; status: number; qrDataUrl?: string; error?: string; state?: string }> {
  if (!serviceConfigured()) return { ok: false, status: 503, error: "WhatsApp service is not configured", state: "unconfigured" };
  const r = await serviceFetch("/qr", {}, 15000);
  if (r.ok && r.body?.qrDataUrl) return { ok: true, status: 200, qrDataUrl: r.body.qrDataUrl };
  // Auth rejection from the service means the API keys have drifted apart
  // (Next's WHATSAPP_API_KEY vs the service's API_KEY) — report THAT, not a
  // generic "unavailable" 503, so the cause is immediately visible.
  if (r.status === 401) {
    return { ok: false, status: 502, error: "WhatsApp service rejected the server API key — WHATSAPP_API_KEY does not match the service's API_KEY", state: "auth_error" };
  }
  if (r.status === 404) {
    // Service up but no QR yet: still connecting/handshaking — a retry will
    // get one. 409 (retryable) rather than a terminal 503.
    return { ok: false, status: 409, error: r.body?.error || "QR is being generated — retry in a few seconds", state: "connecting" };
  }
  return { ok: false, status: 503, error: r.body?.error || "QR unavailable — service unreachable", state: "unreachable" };
}

/** Proper logout/unlink of the linked WhatsApp account: the service logs the
 *  session out with WhatsApp, deletes the stored credentials (the previous
 *  account can never auto-reconnect) and starts fresh so a new QR appears. */
export async function serviceLogout(): Promise<{ ok: boolean; error?: string }> {
  if (!serviceConfigured()) return { ok: false, error: "WhatsApp service is not configured" };
  try {
    const r = await serviceFetch("/logout", { method: "POST" }, 20000);
    if (r.ok) return { ok: true };
    return { ok: false, error: r.body?.error || "Logout failed" };
  } catch {
    return { ok: false, error: "WhatsApp service is unreachable" };
  }
}

/* ------------------------------------------------------------------ */
/* Message building — EXACT reuse of the manual wa.me wording          */
/* ------------------------------------------------------------------ */

/** Same normalization as the staff page's waPhone(): digits only, bare
 *  8-digit numbers get the 965 Kuwait prefix. */
export function normalizeWaPhone(phone: string): string {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.indexOf("965") !== 0 && digits.length === 8) digits = "965" + digits;
  return digits;
}

/**
 * Customer order URL for WhatsApp messages — the SAME signed /o/{id}-{sig}
 * link the manual wa.me workflow uses (orderShortPath from lib/order-link,
 * recomputed from the id — the order's own existing slug, never a new one).
 *
 * Base URL precedence: the TRUSTED public origin resolved from the
 * customer's own checkout request first (resolvePublicOrigin — LAN origin
 * for LAN browsing, current ngrok HTTPS origin through the tunnel, both
 * allowlist-validated so a forged Host header can never inject a link),
 * then APP_BASE_URL (canonical production origin) as the safe fallback.
 */
export function waOrderUrlFor(orderId: number, fallbackBase?: string): string {
  const base = (fallbackBase || "").replace(/\/+$/, "") || customerOrderBaseUrl();
  return base + orderShortPath(orderId);
}

/** Bilingual order message, identical wording to the manual wa.me flow in
 *  internal-orders2.html (ENABLE_DELIVERY_SCHEDULE is false there, so no
 *  schedule line is included here either). Arabic literals are the approved
 *  strings from public/assets/js/i18n-data.js.
 *
 *  RTL rendering: each Arabic paragraph gets a leading RLM (U+200F) and a
 *  trailing RLM. The leading mark makes the RLM the first strong RTL
 *  character of the line so the Arabic reads right-to-left consistently and
 *  neutrals/punctuation resolve the right way; the trailing mark stabilises
 *  the sentence-ending "." and the "،" after a Latin customer name, which
 *  would otherwise attach to the wrong run at the line boundary. RLE/PDF
 *  was tried and made no visible difference on WhatsApp mobile, so the
 *  simpler RLM-only scheme is used. NOTE: these marks correct READING
 *  direction only — they cannot right-ALIGN the bubble (see below). The
 *  marks are invisible controls and are never applied to the mixed
 *  "Link | الرابط :" line or the URL, which must stay LTR and clickable.
 *
 *  Known WhatsApp renderer limitation: WhatsApp picks ONE base direction
 *  per message from its first strong character and aligns the whole bubble
 *  accordingly. This message begins with English ("Dear …"), so the bubble
 *  is LTR/left-aligned and individual paragraphs cannot be aligned
 *  separately — ordinary WhatsApp text messages have no per-paragraph
 *  alignment. */
const RLM = "\u200F";

export function buildOrderMessage(order: {
  customerName: string;
}, orderUrl: string): string {
  const name = order.customerName;
  const rtl = (s: string) => RLM + s + RLM;
  return (
    "Dear " + name + ",\n\n" +
    "Thank you for your order with Al-Nassim Golden Group.\n\n" +
    "YOUR ORDER HAS BEEN RECEIVED.\n\n" +
    "Your order will be delivered within the next 2 days.\n\n" +
    "Please click the link below to view your order.\n\n" +
    rtl("عزيزي " + name + "،") + "\n\n" +
    rtl("نشكرك على طلبك من مجموعة النسيم الذهبية.") + "\n\n" +
    rtl("تم استلام طلبكم.") + "\n\n" +
    rtl("سيتم توصيل طلبك خلال اليومين القادمين.") + "\n\n" +
    rtl("يرجى النقر على الرابط أدناه لرؤية طلبك.") + "\n\n" +
    "Link | الرابط :\n" +
    orderUrl
  );
}

/* ------------------------------------------------------------------ */
/* Automated send (staff-triggered, backend-enforced)                  */
/* ------------------------------------------------------------------ */

export type SendResult =
  | {
      ok: true;
      delivered: true;
      messageId?: string;
      /** Normalized actual customer number (E.164 digits, no +). */
      customerPhone: string;
      /** Number the message was actually sent to. */
      recipient: string;
      /** true when the customer's number was replaced by a testing number. */
      redirected: boolean;
      testMode: boolean;
    }
  | { ok: false; status: number; error: string; customerPhone: string | null; recipient: string | null };

export type DeliveryStatus = "SENT" | "FAILED" | "UNKNOWN";

/**
 * Resolve the effective recipient for one automated send.
 *  - TEST MODE ON:  customer number only if it is on the server allowlist,
 *                   otherwise the primary testing number (redirected).
 *  - TEST MODE OFF: the customer's own validated number — real delivery.
 *    The customer number must normalize to a valid international number or
 *    the send fails; it is never replaced with anything else.
 * The final recipient is validated against the allowlist only while TEST
 * MODE is on — real delivery goes exclusively to the customer's number.
 */
export async function resolveRecipient(
  customerPhoneRaw: string
): Promise<{ customerPhone: string | null; recipient: string; redirected: boolean; testMode: boolean; error?: string }> {
  const testMode = await isTestModeEnabled();
  const customerPhone = normalizeCustomerPhone(customerPhoneRaw);
  if (testMode) {
    const allowed = testRecipients();
    const redirected = !customerPhone || allowed.indexOf(customerPhone) === -1;
    const recipient = redirected ? primaryTestRecipient() : customerPhone as string;
    return { customerPhone, recipient, redirected, testMode };
  }
  // Real delivery: a valid customer number is mandatory.
  if (!customerPhone) {
    return { customerPhone: null, recipient: "", redirected: false, testMode: false, error: "Customer phone number is not a valid international number" };
  }
  return { customerPhone, recipient: customerPhone, redirected: false, testMode: false };
}

export async function sendOrderMessage(
  orderId: number,
  order: { customerName: string; customerPhone: string },
  idempotencyKey: string,
  /** Origin of the request that triggered the send — same fallback role as
   *  the manual wa.me flow's window.location.origin. */
  requestOrigin?: string
): Promise<SendResult> {
  if (!serviceConfigured()) {
    return { ok: false, status: 503, error: "WhatsApp service is not configured on the server", customerPhone: null, recipient: null };
  }

  const resolved = await resolveRecipient(order.customerPhone);
  if (resolved.error || !resolved.customerPhone) {
    return { ok: false, status: 400, error: resolved.error || "Invalid customer phone number", customerPhone: null, recipient: null };
  }
  const { customerPhone, recipient, redirected, testMode } = resolved;

  const message = buildOrderMessage(order, waOrderUrlFor(orderId, requestOrigin));
  let r: { ok: boolean; status: number; body: any };
  try {
    r = await serviceFetch("/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: recipient, message, idempotencyKey }),
    });
  } catch {
    return { ok: false, status: 503, error: "WhatsApp service is unreachable", customerPhone, recipient };
  }

  if (r.ok && r.body && r.body.delivered) {
    return { ok: true, delivered: true, messageId: r.body.messageId, customerPhone, recipient, redirected, testMode };
  }
  // Idempotent replay of an earlier successful send with the same key.
  if (r.ok && r.body && r.body.idempotentReplay) {
    return { ok: true, delivered: true, messageId: undefined, customerPhone, recipient, redirected, testMode };
  }
  const code = r.body?.error || "UNKNOWN_ERROR";
  const map: Record<string, string> = {
    NOT_CONNECTED: "WhatsApp is not connected. Open LINK WHATSAPP and connect first.",
    INVALID_PHONE: "Invalid recipient phone number.",
    INVALID_MESSAGE: "Invalid message content.",
  };
  // The service accepted the request but could not confirm delivery
  // (connection dropped mid-send): report UNKNOWN, not SENT.
  if (r.ok && r.body && r.body.delivered === false) {
    return { ok: false, status: 502, error: "Delivery could not be confirmed — WhatsApp connection dropped during send", customerPhone, recipient };
  }
  return { ok: false, status: r.status === 503 ? 503 : 502, error: map[code] || `WhatsApp service error (${code})`, customerPhone, recipient };
}

/** Idempotency key for one order's automated notification. The service
 *  remembers it for 24h, and the order's whatsappSent flag blocks repeats
 *  after that — a successful send can never be duplicated. */
export function orderIdempotencyKey(orderId: number): string {
  return `order-notif-${orderId}`;
}

/* ------------------------------------------------------------------ */
/* Unified notification lifecycle (automatic + manual share this)      */
/* ------------------------------------------------------------------ */

export type NotifyOutcome = {
  result: "duplicate" | "busy" | "sent" | "failed" | "skipped";
  error?: string;
  messageId?: string | null;
  customerPhone?: string;
  recipient?: string;
  redirected?: boolean;
  testMode?: boolean;
};

/** Atomic claim of the send slot for one order. Uses a conditional
 *  updateMany so only ONE of any number of concurrent auto/manual requests
 *  wins; losers get "busy". A SENDING claim older than 2 minutes is treated
 *  as stale (crashed/restarted process) and may be re-claimed. */
async function claimSendSlot(orderId: number): Promise<boolean> {
  const staleBefore = new Date(Date.now() - 120000);
  const claim = await prisma.order.updateMany({
    where: {
      id: orderId,
      whatsappSent: false,
      OR: [
        { whatsappStatus: { not: "SENDING" } },
        { updatedAt: { lt: staleBefore } },
      ],
    },
    data: { whatsappStatus: "SENDING" },
  });
  return claim.count === 1;
}

/**
 * Send (or retry) the WhatsApp notification for one order. BOTH the
 * automatic post-checkout trigger and the staff manual button call THIS
 * function, so duplicate protection, TEST MODE, the automation toggle and
 * status tracking are defined in exactly one place:
 *   - SENT orders can never be claimed again (duplicate);
 *   - SENDING orders are "busy" until the attempt settles (or goes stale);
 *   - FAILED/PENDING orders can be retried by staff;
 *   - Baileys' own idempotency key (order-notif-<id>) is a second layer.
 * Never throws: all outcomes are recorded on the order.
 */
export async function notifyOrder(
  orderId: number,
  opts: { actorId?: number | null; source: "auto" | "manual"; requestOrigin?: string }
): Promise<NotifyOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, customerPhone: true, whatsappSent: true, whatsappStatus: true },
  });
  if (!order) return { result: "failed", error: "Order not found" };

  // Already delivered: never send again (auto or manual).
  if (order.whatsappSent || order.whatsappStatus === "SENT") {
    return { result: "duplicate" };
  }
  // Automation OFF: no automatic send. (Manual sends require the toggle too —
  // the existing staff-page behaviour.)
  if (!(await isAutomationEnabled())) {
    return { result: "skipped", error: "WhatsApp automation is disabled" };
  }

  if (!(await claimSendSlot(orderId))) {
    const current = await prisma.order.findUnique({
      where: { id: orderId },
      select: { whatsappStatus: true, whatsappSent: true },
    });
    if (current?.whatsappSent) return { result: "duplicate" };
    return { result: "busy", error: "Another notification attempt is in progress" };
  }

  const full = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, customerName: true, customerPhone: true },
  });
  if (!full) return { result: "failed", error: "Order not found" };

  const result = await sendOrderMessage(
    orderId,
    { customerName: full.customerName, customerPhone: full.customerPhone },
    orderIdempotencyKey(orderId),
    opts.requestOrigin
  );

  const stamp = new Date();
  if (result.ok) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        whatsappSent: true,
        whatsappStatus: "SENT",
        whatsappAuto: opts.source === "auto",
        whatsappSentAt: stamp,
        whatsappError: null,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: opts.actorId ?? null,
        action: opts.source === "auto" ? "WHATSAPP_AUTO_SENT" : "WHATSAPP_MANUAL_SENT",
        entity: "Order",
        entityId: String(orderId),
        detail: `${full.orderNumber} | customer=+${result.customerPhone} | recipient=+${result.recipient}${result.redirected ? " (REDIRECTED, TEST MODE)" : ""} | status=SENT | messageId=${result.messageId || "-"} | at=${stamp.toISOString()}`,
      },
    }).catch(() => {});
    return {
      result: "sent",
      messageId: result.messageId,
      customerPhone: "+" + result.customerPhone,
      recipient: "+" + result.recipient,
      redirected: result.redirected,
      testMode: result.testMode,
    };
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      whatsappStatus: "FAILED",
      whatsappError: `${result.error} (at ${stamp.toISOString()})`,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: opts.actorId ?? null,
      action: "WHATSAPP_AUTO_SEND_FAILED",
      entity: "Order",
      entityId: String(orderId),
      detail: `${full.orderNumber} | customer=${result.customerPhone ? "+" + result.customerPhone : order.customerPhone || "-"} | recipient=${result.recipient || "-"} | status=FAILED | at=${stamp.toISOString()} | ${result.error}`,
    },
  }).catch(() => {});
  return { result: "failed", error: result.error };
}

/** Automatic post-checkout trigger. Called once after the backend confirms
 *  order creation, with the TRUSTED public origin resolved from the
 *  customer's own checkout request (see resolvePublicOrigin — null when
 *  untrusted, then APP_BASE_URL is the fallback). Fire-and-forget by
 *  contract: NEVER throws and NEVER affects the order response — all
 *  failures land on the order as FAILED with the reason, and staff can
 *  retry from the staff page. */
export async function autoNotifyAfterOrder(orderId: number, requestOrigin?: string | null): Promise<void> {
  try {
    await notifyOrder(orderId, { actorId: null, source: "auto", requestOrigin: requestOrigin || undefined });
  } catch (e) {
    // Absolute last resort: record the failure on the order so staff can retry.
    try {
      await prisma.order.update({
        where: { id: orderId },
        data: { whatsappStatus: "FAILED", whatsappError: "Auto notification crashed: " + String((e as Error)?.message || e) },
      });
    } catch { /* order may not exist — nothing to record */ }
  }
}
