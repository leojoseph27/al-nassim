/**
 * Signed short order links (/o/{id}-{signature}).
 *
 * A short link must let the SERVER resolve an order without any token in the
 * URL, while remaining impossible to guess or manipulate (e.g. /o/274 must
 * not become /o/275). The numeric id alone would be enumerable, so each link
 * carries an HMAC-SHA256 signature of the id, keyed with the existing
 * JWT_SECRET. The signature is verified server-side before any order data is
 * touched. No database change: nothing needs to be stored — the signature is
 * recomputed from the id on every request.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SECRET } from "@/lib/auth";

// The central public-origin resolver lives in lib/public-origin.ts
// (dependency-free, environment-aware). Re-exported here so every existing
// import site keeps working: order-link remains the single import surface
// for order-link building blocks.
export { customerOrderBaseUrl, resolvePublicOrigin } from "@/lib/public-origin";

export function orderShortPath(id: number): string {
  return "/o/" + id + "-" + shortSig(id);
}

export function verifyOrderShortSlug(slug: string): number | null {
  const m = /^(\d+)-([A-Za-z0-9_-]+)$/.exec(slug || "");
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const expect = Buffer.from(shortSig(id));
  const got = Buffer.from(m[2]);
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  return id;
}

function shortSig(id: number): string {
  return createHmac("sha256", SECRET).update("order-short:" + id).digest("base64url").slice(0, 16);
}
