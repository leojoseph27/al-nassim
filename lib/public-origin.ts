/**
 * Central server-side public-origin resolver for ALL customer-facing links
 * (WhatsApp order notifications, order-tracking links).
 *
 * Environment-aware precedence:
 *   PRODUCTION (NODE_ENV=production / VERCEL / DEPLOYMENT_ENV=production):
 *     the explicitly configured APP_BASE_URL domain ALWAYS wins — a permanent
 *     custom domain is stable and reachable from anywhere, and forwarded
 *     headers on a public ingress must never override it. If APP_BASE_URL is
 *     not configured, the trusted request origin is used as a last resort.
 *   DEVELOPMENT:
 *     the trusted origin resolved from the customer's OWN checkout request
 *     wins — that is the LAN origin for LAN browsing and the CURRENT ngrok
 *     HTTPS origin through a tunnel (ngrok URLs change on every tunnel
 *     restart, so they must be resolved per request, never from .env).
 *     APP_BASE_URL is the fallback when no trusted origin can be
 *     established.
 *
 * Security model (see resolvePublicOrigin): forwarded headers are honoured
 * only for allowlisted tunnel hosts; a plain Host header only for private
 * LAN addresses. A forged header can therefore never inject a link origin.
 *
 * Hosting migrations need NO source changes: everything is driven by the
 * APP_BASE_URL / TRUSTED_PUBLIC_HOSTS environment variables.
 *
 * This module is intentionally dependency-free (no imports) so the pure
 * decision logic can be unit-tested standalone.
 */

/* ------------------------------------------------------------------ */
/* Configured production origin                                        */
/* ------------------------------------------------------------------ */

/**
 * Customer-facing base URL from the APP_BASE_URL server environment
 * variable (production: the permanent custom domain). Empty string when
 * unset or not a valid http(s) URL — it is never trusted blind.
 */
export function customerOrderBaseUrl(): string {
  const raw = process.env.APP_BASE_URL || "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : "";
}

/** True when the app runs as a deployed production build. */
export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.DEPLOYMENT_ENV === "production"
  );
}

/* ------------------------------------------------------------------ */
/* Request-origin resolution (allowlist-gated)                         */
/* ------------------------------------------------------------------ */

/** Trusted tunnel-host allowlist patterns. A pattern starting with "*."
 *  matches any subdomain suffix (e.g. "*.ngrok-free.app" matches
 *  "example.ngrok-free.app"). Exact entries match host or host:port.
 *  Defaults cover ngrok tunnel domains; extend via the
 *  TRUSTED_PUBLIC_HOSTS env var (comma-separated) — e.g. when migrating to
 *  another tunnel or adding a staging domain. */
export function trustedPublicHosts(): string[] {
  const def = ["*.ngrok-free.app", "*.ngrok.app", "*.ngrok.io"];
  const extra = (process.env.TRUSTED_PUBLIC_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return def.concat(extra);
}

function isPrivateLanHost(hostname: string): boolean {
  const m = /^(\d{1,3})(\.\d{1,3}){3}$/.exec(hostname);
  if (!m) return false;
  const o = m[0].split(".").map(Number);
  if (o.some((n) => n > 255)) return false;
  if (o[0] === 10 || o[0] === 127) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  return false;
}

function hostMatchesPattern(hostWithPort: string, pattern: string): boolean {
  const h = hostWithPort.toLowerCase();
  const p = pattern.toLowerCase();
  if (h === p) return true;
  const hostname = h.replace(/:\d+$/, "");
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".ngrok-free.app"
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === p || h === p;
}

/** Resolve the trusted public origin (no trailing slash) from the incoming
 *  request headers, or null when no trusted origin can be established.
 *  Callers fall back to the configured APP_BASE_URL. */
export function resolvePublicOrigin(headers: Headers): string | null {
  const fwdHostRaw = headers.get("x-forwarded-host");
  const fwdProtoRaw = headers.get("x-forwarded-proto");
  const host = (fwdHostRaw ? fwdHostRaw.split(",")[0] : headers.get("host") || "")
    .trim()
    .replace(/\/+$/, "");
  if (!host || !/^[A-Za-z0-9.\-]+(:\d+)?$/.test(host)) return null;

  const hasForwarded = Boolean(fwdHostRaw || fwdProtoRaw || headers.get("forwarded"));
  const proto = (fwdProtoRaw ? fwdProtoRaw.split(",")[0] : "").trim().toLowerCase();
  const scheme = proto === "http" ? "http" : proto === "https" ? "https" : null;

  // Tunnel/public-proxy path: forwarded headers honoured ONLY for
  // allowlisted hosts. Scheme: from X-Forwarded-Proto when sane, otherwise
  // HTTPS (public tunnels and production proxies terminate TLS).
  if (hasForwarded) {
    if (trustedPublicHosts().some((p) => hostMatchesPattern(host, p))) {
      return (scheme === "http" ? "http" : "https") + "://" + host;
    }
    return null; // untrusted forwarded host — never echoed into links
  }

  // Direct LAN path: no proxy involved, plain Host header. Only private
  // LAN addresses are accepted, HTTP only.
  if (scheme === null || scheme === "http") {
    const hostname = host.replace(/:\d+$/, "");
    if (isPrivateLanHost(hostname)) return "http://" + host;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Central entry point — use THIS everywhere                           */
/* ------------------------------------------------------------------ */

/**
 * The public origin for a customer-facing link built from the request that
 * triggered it. Environment-aware precedence (see module doc). Always
 * returns a best-effort origin: "" only when neither the environment nor
 * the request yields anything usable (callers then produce a path-only
 * link rather than an untrusted absolute one).
 */
export function resolveCustomerOrigin(headers: Headers): string {
  const configured = customerOrderBaseUrl();
  if (isProductionRuntime()) {
    // Production: the configured, verified domain always wins.
    return configured || resolvePublicOrigin(headers) || "";
  }
  // Development: dynamic trusted origin first, configured domain fallback.
  return resolvePublicOrigin(headers) || configured;
}