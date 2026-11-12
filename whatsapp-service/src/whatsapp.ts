import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "baileys";
import pino from "pino";
import { EventEmitter } from "events";
import { auth } from "./auth";
import { config } from "./config";

export type ConnectionState = "connecting" | "awaiting_qr" | "open" | "close";

export interface ConnectionStatus {
  state: ConnectionState;
  connected: boolean;
  hasSession: boolean;
  lastQrAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectReason: string | null;
  reconnectAttempts: number;
  loggedInJid: string | null;
}

/**
 * Thin connection manager around a single Baileys socket.
 *
 * Only what an order-notification service needs:
 *  - one socket, one session
 *  - QR printing on first login
 *  - automatic reconnect for recoverable disconnects
 */
class WhatsAppManager extends EventEmitter {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private state: ConnectionState = "close";
  private latestQr: string | null = null;
  private lastQrAt: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastDisconnectAt: string | null = null;
  private lastDisconnectReason: string | null = null;
  private reconnectAttempts = 0;
  private loggedInJid: string | null = null;
  private starting = false;

  // ---- status reporting -------------------------------------------------

  getStatus(): ConnectionStatus {
    return {
      state: this.state,
      connected: this.state === "open",
      hasSession: auth.hasSession(),
      lastQrAt: this.lastQrAt,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectAt: this.lastDisconnectAt,
      lastDisconnectReason: this.lastDisconnectReason,
      reconnectAttempts: this.reconnectAttempts,
      loggedInJid: this.loggedInJid,
    };
  }

  /** QR string of the most recent login code (null if already logged in). */
  getQr(): string | null {
    return this.latestQr;
  }

  // ---- lifecycle ---------------------------------------------------------

  async start(): Promise<void> {
    if (this.starting) return;
    if (this.socket) return;
    this.starting = true;

    try {
      const { state, saveCreds } = await auth.load();
      const { version } = await fetchLatestBaileysVersion();

      const logger = pino({ level: "error" }); // keep WhatsApp internals quiet

      this.state = "connecting";
      this.emit("state", this.state);

      const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false, // we handle the QR ourselves
        syncFullHistory: false,
        markOnlineOnConnect: false,
        browser: ["whatsapp-order-service", "chrome", "1.0.0"],
      });
      this.socket = sock;

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.latestQr = qr;
          this.lastQrAt = new Date().toISOString();
          this.state = "awaiting_qr";
          this.emit("state", this.state);
          this.emit("qr", qr);
        }

        if (connection === "open") {
          this.state = "open";
          this.reconnectAttempts = 0;
          this.loggedInJid = (sock.user?.id as string | undefined) ?? null;
          this.lastConnectedAt = new Date().toISOString();
          this.latestQr = null; // session valid, no QR needed anymore
          this.emit("state", this.state);
        }

        if (connection === "close") {
          this.socket = null;
          const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })
            ?.output?.statusCode;
          const reason = DisconnectReason[statusCode as number] ?? `code ${statusCode}`;
          this.lastDisconnectAt = new Date().toISOString();
          this.lastDisconnectReason = String(reason);
          this.loggedInJid = null;

          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const shouldReconnect =
            this.reconnectAttempts < config.maxReconnectAttempts;
          if (loggedOut) {
            // Session invalidated server-side; stored creds are useless.
            auth.clear();
          }
          /* A logged-out session is NOT terminal for a linking service: after
             clearing the stale credentials, restart the socket so a fresh QR
             is emitted and a (possibly different) number can be linked. The
             reconnect attempt counter still bounds reconnect storms for
             transient errors; loggedOut resets it so linking always works. */
          if (loggedOut) this.reconnectAttempts = 0;
          if (shouldReconnect || loggedOut) {
            if (!loggedOut) this.reconnectAttempts += 1;
            this.state = "connecting";
            this.emit("state", this.state);
            const delayMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 60_000);
            setTimeout(() => {
              void this.start();
            }, delayMs);
          } else {
            this.state = "close";
            this.emit("state", this.state);
          }
        }
      });
    } finally {
      this.starting = false;
    }
  }

  /** Wait until the connection is open (or timeout). */
  async waitForOpen(timeoutMs: number): Promise<void> {
    if (this.state === "open") return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`connection not open within ${timeoutMs}ms (state: ${this.state})`));
      }, timeoutMs);
      const onState = (s: ConnectionState) => {
        if (s === "open") {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off("state", onState);
      };
      this.on("state", onState);
    });
  }

  /**
   * Explicit logout/unlink: invalidate the session with WhatsApp, wipe the
   * stored credentials so the previous account can NEVER auto-reconnect,
   * then start a fresh connection that emits a new QR for a new account.
   */
  async logout(): Promise<void> {
    const sock = this.socket;
    this.socket = null;
    this.loggedInJid = null;
    this.latestQr = null;
    this.reconnectAttempts = 0;
    if (sock) {
      try {
        await sock.logout(); // proper server-side unlink, not just closing
      } catch {
        try { sock.end(undefined); } catch { /* already gone */ }
      }
    }
    auth.clear(); // delete stored creds — the previous account is gone
    this.lastDisconnectAt = new Date().toISOString();
    this.lastDisconnectReason = "explicit-logout";
    // Let the logout close-event settle before starting the fresh socket.
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.state = "connecting";
    this.emit("state", this.state);
    await this.start(); // fresh session -> new QR for the next account
  }

  /** Underlying socket for the sender. */
  getSocket(): ReturnType<typeof makeWASocket> | null {
    return this.socket;
  }

  /** Mask a phone number for logs: keep country code + last 3 digits. */
  static maskPhone(phone: string): string {
    if (phone.length <= 5) return "***";
    return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
  }
}

export const whatsapp = new WhatsAppManager();
export const maskPhone = WhatsAppManager.maskPhone;
