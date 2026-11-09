/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";
// Next.js DEV mode evaluates modules/HMR through eval() (170+ eval call sites
// in the dev chunks) — without 'unsafe-eval' every App Router page fails to
// hydrate: forms submit natively (login "doesn't work"), SPAs never render.
// Production builds contain no eval, so the directive is dev-only.
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

/**
 * Content-Security-Policy — built from an inventory of the resources the
 * storefront and admin actually load:
 *   script  'self' + inline page scripts (the Tailwind Play CDN entry was
 *           removed by the staged local-build migration — every page and
 *           the admin SPAs now load /assets/css/tailwind*.css)
 *   style   'self' + inline styles/blocks + Google Fonts CSS
 *   font    'self' + Google Fonts files + data:
 *   img     'self' + data:/blob: + lh3.googleusercontent.com (product images
 *           imported from the Google Shopping feed)
 *   connect 'self' — the storefront/admin only call their own API
 *
 * 'unsafe-inline' for script/style is a documented limitation of the
 * static-HTML architecture, not an oversight. 'unsafe-eval' is
 * granted ONLY in development (Next dev tooling requires it).
 */
const CSP = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig = {
  // Allows a production build/test in an isolated directory while a dev
  // server (which owns .next) is running: NEXT_DIST_DIR=.next-test next build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    return [
      { source: "/", destination: "/home5.html" },
      // Staff Order Page — the admin login redirects to the extensionless
      // path (it strips ".html"), so serve the page under both.
      { source: "/internal-orders", destination: "/internal-orders.html" },
    ];
  },
  async redirects() {
    return [
      // index.html is retired; home.html is the single homepage.
      { source: "/index.html", destination: "/home.html", permanent: true },
      // Compatibility redirects for the 2026-08 storefront page renames
      // (professional hyphenated filenames). Permanent (308) so bookmarks,
      // shared links and indexed URLs keep resolving; query strings (e.g.
      // ?id=...) are preserved automatically.
      { source: "/product%20view.html", destination: "/product-view.html", permanent: true },
      { source: "/subcategoryui.html", destination: "/houseware-cleaning-tools.html", permanent: true },
      { source: "/home-outdoor-subcategory.html", destination: "/houseware-home-outdoor.html", permanent: true },
      { source: "/kitchenware-subcategory.html", destination: "/houseware-kitchenware.html", permanent: true },
      { source: "/cooling-subcategory.html", destination: "/supermarket-cooling-appliances.html", permanent: true },
      { source: "/trolly-subcategory.html", destination: "/supermarket-trolleys-baskets.html", permanent: true },
      { source: "/shelves-subcategory.html", destination: "/supermarket-shelves-stands.html", permanent: true },
      { source: "/checkout-solutions-subcategory.html", destination: "/supermarket-checkout-solutions.html", permanent: true },
      { source: "/accessories-subcategory.html", destination: "/supermarket-accessories.html", permanent: true },
      { source: "/trolleys-subcategory.html", destination: "/warehouse-trolleys-baskets.html", permanent: true },
      { source: "/forklifts-subcategory.html", destination: "/warehouse-forklifts-pallets.html", permanent: true },
      { source: "/heavy-duty-racking-subcategory.html", destination: "/warehouse-heavy-duty-racking.html", permanent: true },
    ];
  },
  async headers() {
    const headers = [
      {
        // Order Sent sheet (customer page + /o/{slug} short-link delivery):
        // always revalidate so phones never render a stale cached copy after
        // fixes to the sheet or its watermark tape.
        source: "/((?:order-detail\\.html)|o(?:/.*)?)",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
      {
        // Order confirmation sheet: ONE-SHOT view. never cached and never
        // bfcache-restored — Chrome and Safari both disable the back/forward
        // cache for no-store documents, so Back/Forward can never resurrect
        // the old DOM and every load fetches the current guard script.
        source: "/order-send-modified4.html",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
      {
        // Service worker (staff Web Push): always revalidate so staff devices
        // pick up sw.js updates immediately; explicit root scope.
        source: "/sw\\.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // home.html is the entry page iterated on from phones — force
        // revalidation so a stale Safari cache can never serve an old copy
        // that predates carousel/loading fixes.
        source: "/((?:home\\.html)?)",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
      {
        // EVERY HTML document (home5.html and all other public pages): always
        // revalidate. Static public pages used to fall through to Next's
        // default `public, max-age=0`, which mobile browsers (Chrome Android
        // data-saver, scroll prefetch, some WebViews) treat as a licence to
        // serve the cached copy WITHOUT revalidating — the reported "normal
        // tab shows the old layout, private tab shows the new one". HTML may
        // change at any deploy while its URL stays the same, so it must never
        // be trusted from cache: the ETag/Last-Modified revalidation is a
        // cheap 304, so repeat visits stay fast.
        source: "/:path*.(html)",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
      {
        // Versioned storefront assets (CSS/JS). Pages bust caches with ?v=
        // query strings when content changes, so a medium TTL + SWR keeps
        // warm navigations (EN <-> AR, page to page) off the network. SWR is
        // capped at ONE day: a CSS/JS file whose content changed without its
        // URL changing (missed ?v= bump) can then never be served stale for
        // more than a day. Changed ?v= URLs are always a fresh fetch.
        source: "/assets/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=86400" },
        ],
      },
      {
        // Self-hosted font files: gstatic-derived content-hashed filenames
        // plus one variable-icon font pinned by name — safe to cache forever.
        source: "/assets/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Image payload. The -mobile.webp derivatives are content-fresh
        // copies of their PNGs; 7 days + SWR keeps repeat mobile visits warm
        // without risking long-lived staleness. (Never matches .html —
        // order-detail/sw/home rules above keep their no-cache.)
        source: "/:path*.(webp|png|jpg|jpeg|svg|ico)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" },
        ],
      },
      {
        // Applies to every path (including /uploads and other public assets,
        // which the middleware matcher deliberately skips).
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        ],
      },
    ];
    if (isProd) {
      // HSTS only once the site is actually served over HTTPS in production
      // builds — sending it from plain HTTP would break local HTTP access.
      headers[0].headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
    }
    return headers;
  },
};

export default nextConfig;
