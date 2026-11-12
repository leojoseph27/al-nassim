import fs from "fs";
import path from "path";
import { useMultiFileAuthState } from "baileys";
import { config } from "./config";

/**
 * Session persistence on top of Baileys' built-in multi-file auth state.
 *
 * Responsibilities:
 *  - ensure the auth directory exists (outside any VCS, see .gitignore)
 *  - hand out the Baileys auth state + saveCreds callback
 *  - inspect/report whether a saved session exists
 */
export const auth = {
  dir: config.authDir,

  ensureDir(): void {
    if (!fs.existsSync(config.authDir)) {
      fs.mkdirSync(config.authDir, { recursive: true });
    }
  },

  async load() {
    this.ensureDir();
    return useMultiFileAuthState(config.authDir);
  },

  hasSession(): boolean {
    try {
      // Stored creds.json means Baileys can resume without a new QR scan.
      // (The "registered" flag inside is not a reliable indicator; the live
      // connection state is reported separately via /status.)
      fs.accessSync(path.join(config.authDir, "creds.json"));
      return true;
    } catch {
      return false;
    }
  },

  /** Remove the stored session entirely (forces a fresh QR login). */
  clear(): void {
    fs.rmSync(config.authDir, { recursive: true, force: true });
  },
};
