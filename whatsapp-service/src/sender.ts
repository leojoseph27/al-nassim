import { config } from "./config";
import { whatsapp, maskPhone } from "./whatsapp";

export class SendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

// ---- idempotency -----------------------------------------------------------

const idempotencyStore = new Map<string, { result: "sent" | "failed"; at: number }>();

function remember(key: string, result: "sent" | "failed"): void {
  idempotencyStore.set(key, { result, at: Date.now() });
  // opportunistic cleanup
  const cutoff = Date.now() - config.idempotencyTtlMs;
  for (const [k, v] of idempotencyStore) {
    if (v.at < cutoff) idempotencyStore.delete(k);
  }
}

// ---- phone validation ------------------------------------------------------

/**
 * Accepts international format only: digits with optional "+" prefix,
 * 8-15 digits (E.164 without formatting characters).
 * Returns the digits-only MSISDN or null when invalid.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "");
  if (!/^\+?\d{8,15}$/.test(digits)) return null;
  return digits.replace(/^\+/, "");
}

export interface SendRequest {
  phone: string;
  message: string;
  idempotencyKey?: string;
}

export interface SendResult {
  delivered: boolean;
  idempotentReplay: boolean;
  messageId?: string;
  maskedPhone: string;
}

/**
 * Send one plain-text message to one customer.
 * Throws SendError for validation / connection problems.
 */
export async function sendOrderMessage(req: SendRequest): Promise<SendResult> {
  const phone = normalizePhone(req.phone);
  if (!phone) {
    throw new SendError(
      "Invalid phone number. Use international format, e.g. +9665xxxxxxxx",
      "INVALID_PHONE",
    );
  }

  const message = req.message?.trim();
  if (!message || message.length > 4096) {
    throw new SendError("Message is required (max 4096 characters).", "INVALID_MESSAGE");
  }

  const idempotencyKey = req.idempotencyKey?.trim();
  if (idempotencyKey) {
    const prior = idempotencyStore.get(idempotencyKey);
    if (prior) {
      return {
        delivered: prior.result === "sent",
        idempotentReplay: true,
        maskedPhone: maskPhone(phone),
      };
    }
    // Reserve the key before sending so concurrent retries cannot double-send.
    remember(idempotencyKey, "failed");
  }

  const socket = whatsapp.getSocket();
  if (!socket) {
    if (idempotencyKey) idempotencyStore.delete(idempotencyKey);
    throw new SendError("WhatsApp is not connected.", "NOT_CONNECTED");
  }

  try {
    await whatsapp.waitForOpen(config.sendTimeoutMs);
  } catch (err) {
    if (idempotencyKey) idempotencyStore.delete(idempotencyKey);
    throw new SendError((err as Error).message, "NOT_CONNECTED");
  }

  const jid = `${phone}@s.whatsapp.net`;
  const result = await socket.sendMessage(jid, { text: message });
  const ok = Boolean(result?.key?.id);

  if (idempotencyKey) remember(idempotencyKey, ok ? "sent" : "failed");

  return {
    delivered: ok,
    idempotentReplay: false,
    messageId: result?.key?.id ?? undefined,
    maskedPhone: maskPhone(phone),
  };
}
