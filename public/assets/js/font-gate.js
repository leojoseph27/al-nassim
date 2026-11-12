/* ============================================================================
 * AL-NASSIM shared font gate — initial loading screen for storefront pages.
 * ============================================================================
 * Problem: the Material Symbols Outlined icon font is ~1.14 MB. With
 * font-display: swap, icons can flash as raw ligature text ("shopping_cart",
 * "local_shipping", …) while the font downloads — very visible on slow
 * tunnels (Cloudflare Quick Tunnel / ngrok), but possible on any access path.
 *
 * Solution: a render-blocking gate injected BEFORE first paint.
 *   - A synchronously-run script adds `nassim-font-wait` to <html> and
 *     injects CSS that hides <body> and shows a pure-CSS spinner overlay
 *     (the overlay itself uses NO icon font and NO text font — it cannot
 *     suffer from the same problem).
 *   - It then waits for the fonts the page actually needs via the Font
 *     Loading API: Material Symbols Outlined (icons), Inter 400 (body text),
 *     and Manrope 800 (headlines — only requested when the parsed body
 *     actually contains .font-headline, so pages without it are not
 *     delayed).
 *   - HARD TIMEOUT: 4.5 seconds. If a font is slow or fails, the page is
 *     revealed with the existing font-display fallback behaviour rather
 *     than staying blank. Back/forward cache restores reveal immediately.
 *
 * Scope: storefront pages only. Staff/admin pages are not gated.
 * Usage (in <head>, before the font stylesheet):
 *     <script src="/assets/js/font-gate.js"></script>
 * One shared implementation — no per-page loading logic.
 * ======================================================================== */
(function () {
  "use strict";
  if (window.__nassimFontGate) return; // never double-run
  window.__nassimFontGate = true;

  var TIMEOUT_MS = 4500;

  /* ---- 1. Hide the page + show the overlay BEFORE first paint ---------- */
  var docEl = document.documentElement;
  docEl.classList.add("nassim-font-wait");

  var css = document.createElement("style");
  css.id = "nassim-font-gate-style";
  css.textContent =
    "html.nassim-font-wait body { visibility: hidden !important; }" +
    "#nassim-font-gate { position: fixed; inset: 0; z-index: 2147483000;" +
    "  background: #ffffff; display: flex; align-items: center; justify-content: center;" +
    "  flex-direction: column; gap: 14px; }" +
    "html.dark #nassim-font-gate { background: #0a0f14; }" +
    "#nassim-font-gate .nassim-fg-ring { width: 36px; height: 36px;" +
    "  border: 3px solid #e5e7eb; border-top-color: #825335; border-radius: 50%;" +
    "  animation: nassim-fg-spin 0.8s linear infinite; }" +
    "html.dark #nassim-font-gate .nassim-fg-ring { border-color: #374151; border-top-color: #f7b994; }" +
    "@keyframes nassim-fg-spin { to { transform: rotate(360deg); } }" +
    "#nassim-font-gate .nassim-fg-sr { position: absolute; width: 1px; height: 1px;" +
    "  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }" +
    "html.nassim-font-done #nassim-font-gate { display: none !important; }";
  document.head.appendChild(css);

  function ensureOverlay() {
    if (document.getElementById("nassim-font-gate")) return;
    var g = document.createElement("div");
    g.id = "nassim-font-gate";
    g.setAttribute("role", "status");
    g.innerHTML =
      '<div class="nassim-fg-ring" aria-hidden="true"></div>' +
      '<span class="nassim-fg-sr">Loading…</span>';
    (document.body || document.documentElement).appendChild(g);
  }
  if (document.body) ensureOverlay();
  else document.addEventListener("DOMContentLoaded", ensureOverlay);

  /* ---- 2. Wait only for fonts the page actually needs ------------------ */
  function reveal() {
    docEl.classList.remove("nassim-font-wait");
    docEl.classList.add("nassim-font-done");
  }

  var revealTimer = setTimeout(reveal, TIMEOUT_MS); // hard timeout — never stuck
  var revealed = false;
  function finish() {
    if (revealed) return;
    revealed = true;
    clearTimeout(revealTimer);
    /* One frame so freshly-loaded fonts apply before the overlay lifts. */
    setTimeout(function () {
      reveal();
      try { sessionStorage.setItem("nassim-fonts-ok", "1"); } catch (e) {}
    }, 50);
  }

  /* Debug/testing hook: append ?nassim-fg-slow=1 to a URL to simulate a
     font that never finishes — verifies the timeout reveal path. */
  var forcedSlow = /[?&]nassim-fg-slow=1/.test(location.search);

  function gateOnFonts() {
    if (forcedSlow) return new Promise(function () {}); // never resolves
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var jobs = [
      document.fonts.load('24px "Material Symbols Outlined"'),
      document.fonts.load('400 16px "Inter"'),
      document.fonts.load('700 16px "Inter"')
    ];
    // Manrope 800 headlines: only requested when the page really uses them.
    document.addEventListener("DOMContentLoaded", function () {
      if (document.querySelector(".font-headline")) {
        jobs.push(document.fonts.load('800 16px "Manrope"'));
      }
    });
    return Promise.all(jobs)
      .then(function () { return document.fonts.ready; })
      .then(function () {
        // Verify the icon font truly loaded (load() resolves even on failure).
        if (!document.fonts.check('24px "Material Symbols Outlined"')) {
          return new Promise(function () {}); // failed — fall back via timeout
        }
      })
      .catch(function () { return new Promise(function () {}); });
  }

  gateOnFonts().then(finish);

  /* ---- 3. Edge cases ---------------------------------------------------- */
  // Back/forward cache restores must never keep the overlay up.
  window.addEventListener("pageshow", function (e) { if (e.persisted) finish(); });
  // Language bootstrap interplay: Arabic pages stay hidden by their own
  // html.lang-pending rule until i18n finishes — removing our class does not
  // affect that, so both gates compose safely.
})();
