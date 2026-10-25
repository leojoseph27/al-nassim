/**
 * AL-NASSIM Dark Mode Overrides Injector
 * Auto-injects the dark-overrides.css stylesheet into the page <head>.
 * Must load AFTER the Tailwind CDN script so it overrides the generated utilities.
 * Include before other nav scripts: <script src="assets/js/dark-overrides.js"></script>
 */
(function () {
  /* Skip injection when the stylesheet is already linked in <head> as a
     render-blocking <link> (preferred loading path) — never load it twice. */
  // [href*=] (not [href$=]) so versioned links like
  // dark-overrides.css?v=20261013 also count as "already linked" — a query
  // string must not cause a second, unversioned copy to be injected.
  var existing = document.querySelector(
    'link[rel="stylesheet"][href*="dark-overrides.css"]'
  );
  if (existing) return;
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "assets/css/dark-overrides.css";
  document.head.appendChild(link);
})();

/* ============================================================================
   BFCACHE RESTORE — centralized cleanup (all pages)
   ----------------------------------------------------------------------------
   Mobile browsers (Android Chrome, iPhone Safari) restore pages from the
   back/forward cache (bfcache) on Back navigation WITHOUT re-running scripts.
   Two kinds of state set before leaving would otherwise survive the restore and
   break the page:

   1. LOADING SCREEN — each page's `#loading-screen` is visible by default and
      hidden only by a `DOMContentLoaded` handler (which bfcache does NOT fire).
      On restore the overlay reappears covering the content and swallows taps.
   2. SCROLL LOCK — mobile-nav.js / account.js set `body.style.overflow = "hidden"`
      when a drawer/panel opens. If the user leaves while one is open, bfcache
      restores that inline style and the page is frozen. Android Chrome strictly
      enforces `overflow: hidden` (iOS Safari masks it), so this surfaces as an
      Android-only scroll freeze.

   `pageshow` fires on BOTH normal loads AND bfcache restores, so this single
   listener covers every page without editing each HTML file. It is defensive
   only — it removes overlay/lock state that should never persist; it never
   changes first-load behaviour. */
window.addEventListener("pageshow", function () {
  // 1. Never let the loading overlay stay up after a restore.
  var ls = document.getElementById("loading-screen");
  if (ls) { ls.style.opacity = "0"; ls.style.display = "none"; }

  // 2. Never let a scroll lock from a previously-open drawer/panel persist.
  if (document.body) document.body.style.overflow = "";
});

/* ============================================================================
   MOBILE HEADER — premium two-row layout injector (≤767px, all pages)
   ----------------------------------------------------------------------------
   Builds the Row-1 utility controls (Download App / EN|AR / Theme toggle) and
   inserts them into the existing mobile header. The search bar is moved to
   Row 2 purely by CSS (flex-wrap + 100% width) — see dark-overrides.css.

   Reuses (NO second implementations):
   - Theme toggle: built with id="theme-toggle", so theme.js auto-wires it and
     keeps its icon in sync with the desktop toggle (sun/moon swap).
   - Download icon: the same Material "download" glyph used in the desktop nav.
   - EN|AR: matches the desktop selector's look; persists the choice in
     localStorage('nassim-lang'). No translation engine exists yet, so the
     toggle only stores the preference (Arabic/RTL is a roadmap goal).
   - Search: untouched — the existing #mobile-inline-search form + search.js
     keep working; it just sits on Row 2.

   The hamburger (#hamburger-slot) is hidden from the header by CSS but kept in
   the DOM so mobile-nav.js and the bottom-nav Categories button keep working.
   ============================================================================ */
(function () {

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function isMobile() {
    return window.matchMedia("(max-width: 767px), (orientation: portrait)").matches;
  }

  function buildUtils() {
    var row = document.createElement("div");
    row.id = "nassim-mobile-utils";

    // --- Download App (platform-aware) ---
    // The store apps are not published yet: the button stays (the owner wants
    // it visible) but tapping it explains the app is coming soon instead of
    // opening a dead placeholder store URL.
    var dl = document.createElement("button");
    dl.type = "button";
    dl.className = "nassim-mu-btn";
    dl.setAttribute("aria-label", "Our app is coming soon");
    dl.innerHTML = '<span class="material-symbols-outlined">download</span>';
    dl.addEventListener("click", function () { appComingSoon(); });
    row.appendChild(dl);

    /* --- EN | AR language selector: UI-ONLY storefront toggle ------------
       Visible next to the Download icon (matching the desktop header order).
       Persists the choice in localStorage('nassim-lang') and swaps the
       highlighted side via window.NassimLang (wired by the shared module
       below), but translates NOTHING yet — no dictionary, no RTL, no reload.
       The future Arabic/RTL engine (roadmap H-P02) can consume the stored
       preference; default stays English. */
    var lang = document.createElement("button");
    lang.type = "button";
    lang.className = "nassim-mu-btn nassim-mu-lang";
    lang.setAttribute("aria-label", "Language: English or Arabic");
    lang.innerHTML =
      '<span class="nassim-mu-opt" data-lang="en">EN</span>' +
      '<span class="nassim-mu-sep">|</span>' +
      '<span class="nassim-mu-opt" data-lang="ar">عربي</span>';
    row.appendChild(lang);

    // --- Theme toggle (reuses theme.js via id="theme-toggle") ---
    var theme = document.createElement("button");
    theme.type = "button";
    theme.id = "theme-toggle";                       // theme.js wires all #theme-toggle buttons
    theme.className = "nassim-mu-btn";
    theme.setAttribute("aria-label", "Toggle dark mode");
    // Icon set here; theme.js updateIcons() will correct it for the current mode.
    theme.innerHTML = '<span class="material-symbols-outlined">dark_mode</span>';
    row.appendChild(theme);

    return row;
  }

  /** Lightweight "coming soon" notice used by the app-download buttons. */
  function appComingSoon() {
    var t = document.getElementById("nassim-app-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "nassim-app-toast";
      t.style.cssText = "position:fixed;left:50%;bottom:5.5rem;transform:translateX(-50%);z-index:99999;background:#000308;color:#fff;font-size:12px;font-weight:700;letter-spacing:.06em;padding:.6rem 1.1rem;border-radius:.5rem;opacity:0;transition:opacity .25s ease;pointer-events:none;";
      t.textContent = "OUR APP IS COMING SOON";
      document.body.appendChild(t);
    }
    requestAnimationFrame(function () { t.style.opacity = "1"; });
    clearTimeout(appComingSoon._t);
    appComingSoon._t = setTimeout(function () { t.style.opacity = "0"; }, 2200);
  }

  function inject() {
    if (!isMobile()) return;
    if (document.getElementById("nassim-mobile-utils")) return; // already injected
    /* Pages can opt out of the legacy injected utility row by setting
       data-nassim-no-mobile-utils on <html> (standardized pages build their
       own mobile header utilities). */
    if (document.documentElement.getAttribute("data-nassim-no-mobile-utils") === "1") return;
    var nav = document.querySelector("nav.fixed.top-0");
    if (!nav) return;
    var container = nav.querySelector(".flex.justify-between");
    if (!container) return;
    // Insert the utility row right AFTER the logo group (the first child), so the
    // DOM order is [logo-group][mobile-utils][search]. With the search forced to
    // 100% width (CSS), row 1 = logo + utils, and the search wraps onto row 2.
    var logoGroup = container.querySelector("a[href=\"home5.html\"]");
    var anchor = logoGroup ? logoGroup.parentElement : container.firstChild;
    container.insertBefore(buildUtils(), anchor ? anchor.nextSibling : null);
    // theme.js may have run before this button existed — re-trigger its init so
    // the new #theme-toggle gets wired + its icon synced to the current mode.
    if (typeof window.__nassimThemeInit === "function") {
      // Re-run theme icon sync by dispatching a storage event is heavy; instead,
      // call the public toggle twice trick is risky. Safer: theme.js init() is
      // idempotent and queries #theme-toggle fresh each run, but it isn't exposed.
      // So we manually wire the click as a fallback (theme.js also wires it; the
      // data-theme-wired guard prevents double-binding).
      var btn = container.querySelector("#theme-toggle:last-child");
      if (btn && btn.getAttribute("data-theme-wired") !== "1" && typeof window.__nassimThemeToggle === "function") {
        // theme.js init() will wire it on DOMContentLoaded; if that already fired,
        // wire it here as a guaranteed fallback.
        btn.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation();
          window.__nassimThemeToggle();
        });
        // Sync icon to current mode
        var isDark = document.documentElement.classList.contains("dark");
        var icon = btn.querySelector(".material-symbols-outlined");
        if (icon) icon.textContent = isDark ? "light_mode" : "dark_mode";
      }
    }
  }

  ready(inject);
  // Re-inject when crossing into the mobile breakpoint (e.g. desktop resize)
  var mq = window.matchMedia("(max-width: 767px), (orientation: portrait)");
  if (mq.addEventListener) mq.addEventListener("change", function () { if (isMobile()) inject(); else { var e = document.getElementById("nassim-mobile-utils"); if (e) e.remove(); } });
  else if (mq.addListener) mq.addListener(function () { if (isMobile()) inject(); else { var e = document.getElementById("nassim-mobile-utils"); if (e) e.remove(); } });

  /* Re-wire language toggles after a breakpoint re-injection. */
  function wireLangAfterInject() {
    if (window.NassimLang && window.NassimLang.wire) window.NassimLang.wire();
  }
  var _origInject = inject;
  inject = function () { _origInject(); wireLangAfterInject(); };
})();

/* ============================================================================
   EN | AR LANGUAGE TOGGLE — shared, storefront-wide, UI-ONLY
   ----------------------------------------------------------------------------
   One mechanism for every language control on the customer storefront:
     - the desktop header "EN | AR" button (sits next to the Download icon),
     - the mobile header utility row built above (Download | EN|AR | Theme),
     - the "Language  EN | AR" row inside the hamburger drawer.

   Behavior (deliberately minimal — presentation strategy):
     - Persists the choice in localStorage('nassim-lang'); default 'en'.
     - Swaps the highlighted side of every wired control (aria + .is-active /
       .nassim-lang-on/.nassim-lang-off states, styled in dark-overrides.css).
     - Translates NOTHING: no dictionary, no RTL/dir switch, no reload. When
       the Arabic/RTL engine (roadmap H-P02) ships it can read the stored
       preference via window.NassimLang.get().

   Detection is structural (a <button> whose direct spans are exactly "EN"
   and "AR" with a short total label), so per-page markup variants and
   dynamically built controls (drawer, injected rows) are all covered. The
   Admin SPA / internal pages do not load this script and are unaffected.
   ============================================================================ */
(function () {
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function findLangButtons() {
    var found = [];
    document.querySelectorAll("button").forEach(function (btn) {
      if (btn.hasAttribute("data-lang-wired")) return;
      var en = null, ar = null;
      btn.querySelectorAll("span").forEach(function (s) {
        var t = (s.textContent || "").trim();
        if (t === "EN" && !en) en = s;
        if ((t === "AR" || t === "عربي") && !ar) ar = s;
      });
      if (!en || !ar) return;
      // Guard: only compact EN|AR switches, not unrelated buttons that
      // happen to contain both strings. The label may include a leading icon
      // ligature + word (e.g. "language Language EN | عربي" in the drawer), so
      // allow some prefix and require EN to precede AR.
      var label = (btn.textContent || "").replace(/\s+/g, " ").trim();
      if (label.length > 40) return;
      if (label.indexOf("EN") === -1) return;
      var iAr = label.indexOf("AR"), iArB = label.indexOf("عربي");
      if (iAr === -1 && iArB === -1) return;
      if (label.indexOf("EN") > (iArB !== -1 ? iArB : iAr)) return;
      found.push({ btn: btn, en: en, ar: ar });
    });
    return found;
  }

  window.NassimLang = {
    get: function () {
      try { return localStorage.getItem("nassim-lang") === "ar" ? "ar" : "en"; } catch (e) { return "en"; }
    },
    set: function (lang) {
      var v = lang === "ar" ? "ar" : "en";
      var changed = this.get() !== v;
      try { localStorage.setItem("nassim-lang", v); } catch (e) {}
      this.sync();
      // Let listening pages re-render in the chosen language (e.g. the
      // order confirmation page). Fires only when the value actually changed.
      if (changed) {
        try { window.dispatchEvent(new CustomEvent("nassim-langchange", { detail: { lang: v } })); } catch (e) {}
      }
    },
    toggle: function () {
      /* LANGUAGE TOGGLE = SAVE + FULL RELOAD: the newly selected language is
         saved with the existing "nassim-lang" localStorage key, then the
         current page is reloaded so page initialization applies the complete
         translation and all RTL/LTR layout from scratch — no live DOM
         translation, no partially updated page. */
      var v = this.get() === "ar" ? "en" : "ar";
      try { localStorage.setItem("nassim-lang", v); } catch (e) {}
      location.reload();
    },
    // Reflect the stored language on every wired control. Pure presentation.
    sync: function () {
      var active = this.get();
      document.querySelectorAll('button[data-lang-wired] [data-lang]').forEach(function (opt) {
        var on = opt.getAttribute("data-lang") === active;
        opt.classList.toggle("nassim-lang-on", on);
        opt.classList.toggle("nassim-lang-off", !on);
        if (opt.classList.contains("nassim-mu-opt")) opt.classList.toggle("is-active", on);
      });
      document.querySelectorAll('button[data-lang-wired]').forEach(function (btn) {
        btn.setAttribute("aria-label", active === "ar" ? "Language: Arabic selected" : "Language: English selected");
      });
    },
    // Wire every EN|AR control found in the document (idempotent).
    wire: function () {
      findLangButtons().forEach(function (pair) {
        pair.btn.setAttribute("data-lang-wired", "1");
        pair.btn.style.display = ""; // clear any legacy inline hide
        pair.en.setAttribute("data-lang", "en");
        pair.ar.setAttribute("data-lang", "ar");
        // ONE toggle: the entire control is a single click/tap target —
        // EN, |, عربي and the padded area all toggle the language.
        pair.btn.addEventListener("click", function () {
          window.NassimLang.toggle();
        });
      });
      this.sync();
    }
  };

  ready(function () { window.NassimLang.wire(); });
  window.addEventListener("load", function () { window.NassimLang.wire(); });
  // Late pass: the hamburger drawer and other deferred markup may render
  // after load — wire those too (idempotent).
  setTimeout(function () { window.NassimLang.wire(); }, 1200);
  // The hamburger drawer rebuilds its utilities row when it opens, which can
  // replace an already-wired button with fresh markup. Re-wire whenever a
  // button enters the DOM (cheap scan, idempotent, presentation-only).
  if (window.MutationObserver) {
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var add = muts[i].addedNodes;
        for (var j = 0; j < add.length; j++) {
          var n = add[j];
          if (n.nodeType === 1 && (n.tagName === "BUTTON" || n.querySelector("button"))) {
            window.NassimLang.wire();
            return;
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();

/* ============================================================================
   MOBILE LANGUAGE SELECTOR — OPPOSITE-LANGUAGE DROPDOWN (mobile only)
   ----------------------------------------------------------------------------
   The mobile top-nav selector (#home5-lang-btn, shown <=767px) previously
   toggled the language on a single tap. Mirroring the DESKTOP selector's
   behavior (which shows the current language and offers ONLY the other one
   in its dropdown), a tap on the mobile selector now opens a compact
   dropdown containing ONLY the opposite language:

     English selected →  ENG  → tap → [ عربي ]
     Arabic selected  →  عربي → tap → [ ENG  ]

   The dropdown reuses the existing dropdown/option classes for its look
   (.dark-glass-dropdown / .h5-lang-opt visual language) at mobile scale,
   anchored under the selector, clamped to the viewport, and direction-aware
   (works in LTR English and RTL Arabic). Switching still uses the EXISTING
   window.NassimLang.toggle() — localStorage('nassim-lang') + reload — so
   persistence and the i18n system are untouched, no new translations are
   added, and desktop (>=768px) is never affected: the interceptor no-ops
   there and the desktop #home5-lang-dd keeps its own wiring. */
(function () {
  var MENU_ID = "nassim-m-lang-menu";
  function isMobileLangCtx() {
    return window.matchMedia("(max-width: 767px), (orientation: portrait)").matches;
  }
  function currentLang() {
    return window.NassimLang && window.NassimLang.get
      ? window.NassimLang.get()
      : "en";
  }
  function menu() {
    return document.getElementById(MENU_ID);
  }
  function closeMenu() {
    var m = menu();
    if (m) m.remove();
    var btn = document.getElementById("home5-lang-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function openMenu(btn) {
    closeMenu();
    var ar = currentLang() !== "ar";
    var m = document.createElement("div");
    m.id = MENU_ID;
    m.setAttribute("role", "menu");
    m.setAttribute("aria-label", "Language");
    /* Mobile-scale version of the existing dropdown look: same rounded
       border/shadow/glass language, compact for the mobile top nav. */
    var dark = document.documentElement.classList.contains("dark");
    m.style.cssText =
      "position:fixed;z-index:99990;min-width:72px;padding:4px;border-radius:12px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,0.18);border:1px solid " +
      (dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)") + ";" +
      "background:" + (dark ? "rgba(17,29,39,0.97)" : "rgba(247,249,255,0.97)") + ";" +
      "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);";

    var opt = document.createElement("button");
    opt.type = "button";
    opt.className = "h5-lang-opt";
    opt.setAttribute("role", "menuitem");
    opt.setAttribute("data-h5-lang", ar ? "ar" : "en");
    opt.textContent = ar ? "عربي" : "ENG";
    opt.style.cssText =
      "display:flex;align-items:center;justify-content:center;width:100%;" +
      "padding:8px 14px;border:none;background:none;cursor:pointer;" +
      "border-radius:8px;font-size:13px;font-weight:700;letter-spacing:0.08em;" +
      "font-family:inherit;color:" + (dark ? "#fff" : "#111d27") + ";";
    opt.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      /* EXISTING switch mechanism: saves 'nassim-lang' and reloads. */
      if (window.NassimLang && window.NassimLang.toggle) window.NassimLang.toggle();
    });
    opt.addEventListener("mouseenter", function () {
      opt.style.background = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
    });
    opt.addEventListener("mouseleave", function () {
      opt.style.background = "none";
    });
    m.appendChild(opt);

    /* Anchor under the selector, clamped inside the viewport. Using the
       button's live rect keeps it correct in RTL (where the selector sits
       further left) and on every page/width. */
    var r = btn.getBoundingClientRect();
    m.style.visibility = "hidden";
    document.body.appendChild(m);
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - mw / 2),
      window.innerWidth - mw - 8);
    var y = Math.min(r.bottom + 6, window.innerHeight - mh - 8);
    m.style.left = x + "px";
    m.style.top = y + "px";
    m.style.visibility = "";
    btn.setAttribute("aria-expanded", "true");
  }

  /* Capture phase: runs BEFORE the button's own NassimLang toggle listener,
     so on mobile the whole selector becomes the dropdown trigger instead of
     an instant toggle. Desktop never enters this branch. */
  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest) return;
    var m = menu();
    var btn = e.target.closest("#home5-lang-btn");
    if (btn) {
      if (!isMobileLangCtx()) return; // desktop: existing behavior untouched
      e.preventDefault();
      e.stopPropagation();
      if (m) closeMenu();
      else openMenu(btn);
      return;
    }
    /* Tap anywhere outside an open dropdown closes it. */
    if (m && !m.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
  });

  /* The mobile trigger shows the CURRENT language ("ENG" / "عربي") — the
     same label the desktop selector uses. Mobile only; desktop markup is
     never touched. Idempotent. */
  function syncMobileLangLabel() {
    if (!isMobileLangCtx()) return;
    var btn = document.getElementById("home5-lang-btn");
    if (!btn) return;
    var en = btn.querySelector('[data-lang="en"]');
    if (en && en.textContent !== "ENG") en.textContent = "ENG";
    var ar = btn.querySelector('[data-lang="ar"]');
    if (ar && ar.textContent !== "عربي") ar.textContent = "عربي";
  }
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  ready(syncMobileLangLabel);
  window.addEventListener("load", syncMobileLangLabel);
  var langMq = window.matchMedia("(max-width: 767px), (orientation: portrait)");
  if (langMq.addEventListener) langMq.addEventListener("change", syncMobileLangLabel);
  else if (langMq.addListener) langMq.addListener(syncMobileLangLabel);
})();

/* ============================================================================
   MOBILE HEADER-HEIGHT SYNC — global, dynamic, no hard-coded pixels
   ----------------------------------------------------------------------------
   The fixed mobile header (<nav class="fixed w-full z-50 ... top-0">) is shared
   across every storefront page. Its rendered height varies (logo size + the
   injected utility row + the wrapped search bar) and was previously
   compensated by PAGE-SPECIFIC hard-coded paddings (pt-20/pt-32/pt-36) that
   didn't match reality → header overlapped first content on many pages.

   This ONE centralized routine (loaded on all 23 pages via dark-overrides.js):
   - Measures the real, live height of the fixed header (offsetHeight).
   - Publishes it as --mobile-header-height on <html>.
   - Re-measures on load, on every header resize (ResizeObserver), and on
     viewport/orientation changes (which re-wrap the header rows).
   - Clears the variable to 0 on desktop/tablet so no mobile padding leaks.
   The matching CSS in dark-overrides.css (mobile-only @media) sets
   scroll-padding-top + the page top spacing from this variable, so EVERY page
   begins exactly below the header with no overlap and no gap, and adapts
   automatically if the header ever changes height.
   ============================================================================ */
(function () {
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var html = document.documentElement;
    // The fixed header is the first <nav> with .fixed on the page.
    var nav = document.querySelector("nav.fixed");

    function apply() {
      if (!nav) return;
      if (window.matchMedia("(max-width: 767px), (orientation: portrait)").matches) {
        // offsetHeight includes the logo + utility row + wrapped search row,
        // i.e. the true on-screen header height the page content must clear.
        html.style.setProperty("--mobile-header-height", nav.offsetHeight + "px");
      } else {
        // Desktop/tablet: clear so no mobile-only padding leaks upward.
        html.style.setProperty("--mobile-header-height", "0px");
      }
    }

    // First useful measurement (header may still be settling; later passes refine).
    apply();
    // Re-measure once fonts/images/utility-row settle.
    window.addEventListener("load", apply);
    // Track any future header resize (responsive content, dynamic injection,
    // orientation change re-wrapping the search row).
    if (window.ResizeObserver && nav) {
      new ResizeObserver(apply).observe(nav);
    }
    // Re-evaluate mobile-vs-desktop branch on viewport/orientation changes.
    window.addEventListener("resize", apply, { passive: true });
    window.addEventListener("orientationchange", apply);
  });
})();


/* 2026-10-25: mobile bottom-nav items — solid white in dark mode, applied as
   inline !important so no stylesheet rule can render them grey. Light mode
   restores the stylesheet color. Re-applied on theme flips and re-renders. */
(function () {
  function applyMbnavColors() {
    var dark = document.documentElement.classList.contains("dark");
    document.querySelectorAll("#mobile-bottom-nav .mbnav-item").forEach(function (el) {
      if (dark) el.style.setProperty("color", "#ffffff", "important");
      else el.style.removeProperty("color");
    });
  }
  applyMbnavColors();
  document.addEventListener("DOMContentLoaded", applyMbnavColors);
  window.addEventListener("load", applyNavColorsRetry);
  function applyNavColorsRetry() { applyMbnavColors(); setTimeout(applyMbnavColors, 300); }
  new MutationObserver(function () { applyMbnavColors(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
})();
