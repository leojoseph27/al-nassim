import "dotenv/config";
import path from "path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "127.0.0.1",

  /** Secret key required by protected endpoints (/qr, /send-message). */
  apiKey: required("API_KEY"),

  /** Directory where the WhatsApp session credentials are stored. */
  authDir: path.resolve(process.cwd(), process.env.AUTH_DIR ?? "auth"),

  /**
   * Idle timeout (ms) after which pending messages are rejected when the
   * socket is not connected.
   */
  sendTimeoutMs: Number(process.env.SEND_TIMEOUT_MS ?? 30000),

  /**
   * In-memory idempotency entries live for this long (ms). Duplicate
   * notifications with the same idempotency key inside the window are
   * rejected.
   */
  idempotencyTtlMs: Number(process.env.IDEMPOTENCY_TTL_MS ?? 24 * 60 * 60 * 1000),

  /** Max reconnect attempts per run before giving up. */
  maxReconnectAttempts: Number(process.env.MAX_RECONNECT_ATTEMPTS ?? 10),
};
