/* ---- AR-only RTL mirroring of the address grid ----
   Arabic checkout: the existing two-column grid is mirrored with direction:
   rtl, so Governorate (DOM-first) sits on the physical RIGHT and Area on the
   physical LEFT, side-by-side — the same two-column row structure as English.
   Visual only — DOM/tab order, the Governorate→Area dependency, validation
   and the order payload are unchanged. English is unaffected (html.lang-ar
   scoped, desktop only; mobile keeps the grid's single-column layout). */
(function () {
  var style = document.createElement("style");
  style.id = "nassim-checkout-rtl-order";
  style.textContent =
    "@media (min-width: 768px) and (orientation: landscape) {" +
    "  html.lang-ar div.grid:has(> div .nassim-dd #cust-governorate) { direction: rtl; }" +
    "}";
  function mount() { document.head.appendChild(style); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
/**
 * AL-NASSIM Checkout Logic (Sprint 3)
 * ============================================================================
 * - Reads cart from localStorage (guest) or falls back gracefully.
 * - Auto-populates form fields when logged in.
 * - Builds full address from Kuwait address components.
 * - Supports guest checkout (email optional) + registered checkout.
 * - Prevents double submission with loading state.
 * - Clears cart after successful order.
 * ============================================================================
 */
(function () {
  "use strict";
  var CART_KEY = "nassim_cart";
  var IDEM_KEY = "nassim_checkout_idem";
  var submitting = false;

  /* Kuwait Governorate → Area data (dependent dropdowns).
     The reference data lives in assets/js/nassim-locations-data.js — 196
     areas across 6 governorates with the original website values as stable
     IDs and exact EN/AR labels. The fallback below keeps the page working
     (empty dropdowns with "-- Select --" defaults) if that file fails. */
  var NASSIM_CHECKOUT_LOCATIONS = window.NASSIM_CHECKOUT_LOCATIONS || { governorates: [] };

  function checkoutLang() {
    try { return localStorage.getItem("nassim-lang") === "ar" ? "ar" : "en"; } catch (e) { return "en"; }
  }
  function locationName(entry) {
    if (!entry) return "";
    var lang = checkoutLang();
    return (lang === "ar" && entry.ar) ? entry.ar : (entry.en || entry.ar || entry.id);
  }
  function findGovernorate(id) {
    return (NASSIM_CHECKOUT_LOCATIONS.governorates || []).find(function (g) { return g.id === id; }) || null;
  }

  /* Governorate → Area dependent dropdowns. Area stays disabled until a
     Governorate is chosen; changing the Governorate resets the Area list so
     no Area from the previous Governorate survives. */
  function populateGovernorateSelect() {
    var govSel = document.getElementById("cust-governorate");
    if (!govSel) return;
    var current = govSel.value;
    govSel.innerHTML = "";
    var def = document.createElement("option");
    def.value = ""; def.textContent = checkoutLang() === "ar" ? "-- اختر المحافظة --" : "-- Select Governorate --";
    govSel.appendChild(def);
    /* Display order only: sorted alphabetically by the ENGLISH name (the
       same order in EN and AR); the dataset and its ids are untouched. */
    (NASSIM_CHECKOUT_LOCATIONS.governorates || []).slice()
      .sort(function (a, b) { return a.en < b.en ? -1 : a.en > b.en ? 1 : 0; })
      .forEach(function (g) {
      var o = document.createElement("option");
      o.value = g.id; o.textContent = locationName(g);
      govSel.appendChild(o);
    });
    // keep the previous selection only if it still exists
    govSel.value = findGovernorate(current) ? current : "";
    populateAreaSelect(govSel.value);
  }
  function populateAreaSelect(govId) {
    var areaSel = document.getElementById("cust-area");
    if (!areaSel) return;
    areaSel.innerHTML = "";
    var def = document.createElement("option");
    def.value = ""; def.textContent = checkoutLang() === "ar" ? "-- اختر المنطقة --" : "-- Select Area --";
    areaSel.appendChild(def);
    var gov = findGovernorate(govId);
    /* Same English-name display sort for the Area list, per governorate. */
    ((gov && gov.areas) || []).slice()
      .sort(function (a, b) { return a.en < b.en ? -1 : a.en > b.en ? 1 : 0; })
      .forEach(function (a) {
      var o = document.createElement("option");
      o.value = a.id; o.textContent = locationName(a);
      areaSel.appendChild(o);
    });
    areaSel.disabled = !gov;
    areaSel.value = "";
  }
  function initLocationSelects() {
    var govSel = document.getElementById("cust-governorate");
    if (!govSel || govSel.dataset.locInit === "1") return;
    govSel.dataset.locInit = "1";
    populateGovernorateSelect();
    govSel.addEventListener("change", function () {
      populateAreaSelect(govSel.value); // resets + disables Area when empty
    });
    // re-render option labels when the customer switches language
    window.addEventListener("nassim-langchange", populateGovernorateSelect);
    enhanceLocationDropdowns();
  }

  /* ---- Governorate / Area shared dropdown component ----
     Native select popups flip UPWARD when the option list is taller than the
     space below the field (the 63-item Area list), which made Area behave
     differently from Governorate. Both selects are upgraded to ONE custom
     component that always opens DOWNWARD and renders identically.
     The native <select> stays in the DOM as the source of truth: validation,
     the Governorate → Area dependency, the order payload and every existing
     change listener keep working unchanged — the UI only mirrors it and
     writes selections back through the select's own change event. */
  var nassimDDInstances = [];
  function closeAllNassimDD(except) {
    nassimDDInstances.forEach(function (dd) { if (dd !== except) dd.close(); });
  }
  document.addEventListener("click", function (e) {
    nassimDDInstances.forEach(function (dd) {
      if (!dd.wrap.contains(e.target)) dd.close();
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllNassimDD();
  });

  function enhanceLocationSelect(sel) {
    if (!sel || sel.dataset.ddInit === "1") return;
    sel.dataset.ddInit = "1";

    var wrap = document.createElement("div");
    wrap.className = "nassim-dd";
    sel.parentNode.insertBefore(wrap, sel);

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nassim-dd-toggle w-full bg-surface-container-low dark:bg-surface-container-high border border-outline-variant/40 dark:border-outline-variant/50 text-on-surface dark:text-white text-sm px-4 py-3 rounded-sm focus:outline-none focus:ring-1 focus:ring-secondary";
    toggle.setAttribute("aria-haspopup", "listbox");
    toggle.innerHTML =
      '<span class="nassim-dd-value"></span>' +
      '<span class="material-symbols-outlined nassim-dd-arrow" aria-hidden="true">expand_more</span>';

    var panel = document.createElement("div");
    panel.className = "nassim-dd-panel w-full bg-surface-container-lowest dark:bg-surface-container-high border border-outline-variant/40 dark:border-outline-variant/50 rounded-sm";
    panel.setAttribute("role", "listbox");

    wrap.appendChild(toggle);
    wrap.appendChild(panel);
    wrap.appendChild(sel);
    sel.classList.add("nassim-dd-native");
    sel.tabIndex = -1; // the toggle is the single keyboard/focus entry point

    var valueEl = toggle.querySelector(".nassim-dd-value");

    function sync() {
      var opt = sel.options[sel.selectedIndex];
      valueEl.textContent = opt ? opt.textContent : "";
      valueEl.classList.toggle("is-placeholder", !sel.value);
      toggle.classList.toggle("is-disabled", sel.disabled);
      toggle.setAttribute("aria-disabled", sel.disabled ? "true" : "false");
      if (!wrap.classList.contains("is-open")) return; // options rebuilt lazily on open
      buildOptions();
    }
    function buildOptions() {
      panel.innerHTML = "";
      Array.prototype.forEach.call(sel.options, function (o) {
        var item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "option");
        item.className = "nassim-dd-option" +
          (o.value === sel.value ? " is-selected" : "") +
          (!o.value ? " is-placeholder" : "");
        item.textContent = o.textContent;
        item.addEventListener("click", function () {
          sel.value = o.value;
          sel.dispatchEvent(new Event("change", { bubbles: true })); // existing listeners run
          dd.close();
          sync();
        });
        panel.appendChild(item);
      });
    }
    var dd = {
      wrap: wrap,
      open: function () {
        if (sel.disabled) return;
        closeAllNassimDD(dd);
        buildOptions();
        wrap.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
        var selected = panel.querySelector(".is-selected");
        if (selected) selected.scrollIntoView({ block: "nearest" });
      },
      close: function () {
        wrap.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      },
      isOpen: function () { return wrap.classList.contains("is-open"); }
    };
    nassimDDInstances.push(dd);

    toggle.addEventListener("click", function () {
      dd.isOpen() ? dd.close() : dd.open();
    });
    toggle.addEventListener("keydown", function (e) {
      if (sel.disabled) return;
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!dd.isOpen()) dd.open();
      }
    });

    // keep the UI in sync with programmatic updates (populate*,
    // disabled toggling, language switch, saved-address prefill)
    sel.addEventListener("change", sync);
    if (window.MutationObserver) {
      new MutationObserver(sync).observe(sel, { childList: true, attributes: true, attributeFilter: ["disabled"] });
    }
    var lastKey = "";
    setInterval(function () {
      var key = sel.value + "|" + sel.disabled + "|" + sel.options.length;
      if (key !== lastKey) { lastKey = key; sync(); }
    }, 300);
    sync();
  }

  function enhanceLocationDropdowns() {
    enhanceLocationSelect(document.getElementById("cust-governorate"));
    enhanceLocationSelect(document.getElementById("cust-area"));
  }
  /* Display name for a location id in the current language (falls back to
     the id so unknown/legacy values still reach the backend). */
  function locationDisplayName(kind, id) {
    if (kind === "gov") {
      var g = findGovernorate(id);
      return g ? locationName(g) : id;
    }
    var a = null;
    (NASSIM_CHECKOUT_LOCATIONS.governorates || []).forEach(function (g) {
      (g.areas || []).forEach(function (x) { if (x.id === id) a = x; });
    });
    return a ? locationName(a) : id;
  }

  /* Shipping rule for DISPLAY ONLY — same defaults as the server
     (lib/shipping.ts). Fetched from /api/shipping so a settings change is
     reflected without editing this file; the server recomputes the real fee
     from DB prices at order creation and never trusts the browser. */
  var SHIPPING_RULE = { threshold: 20, feeBelow: 1, feeAtOrAbove: 0 };
  fetch("/api/shipping", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.success && d.data) {
        SHIPPING_RULE = {
          threshold: Number(d.data.threshold) || SHIPPING_RULE.threshold,
          feeBelow: Number(d.data.feeBelow) || 0,
          feeAtOrAbove: Number(d.data.feeAtOrAbove) || 0
        };
        renderSummary();
      }
    })
    .catch(function () {});
  function shippingFor(subtotal) { return subtotal < SHIPPING_RULE.threshold ? SHIPPING_RULE.feeBelow : SHIPPING_RULE.feeAtOrAbove; }

  function readStore(key) { try { var raw = localStorage.getItem(key); if (!raw) return null; var p = JSON.parse(raw); return p && p.state ? p.state : p; } catch (e) { return null; } }
  function getCart() { var s = readStore(CART_KEY); return s && s.items ? s.items : []; }
  function formatKd(v, c) { return (c || "KD") + " " + Number(v).toFixed(3); }
  /* Escape DB/product-controlled values before insertion into innerHTML. */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* One idempotency key per checkout submission. Survives a page refresh or a
     retry after a lost network response, so the server can recognise a replay
     (double-click, retry, refresh) and return the original order instead of
     creating a duplicate. Cleared after a successful order — the next checkout
     gets a fresh key. */
  function getIdempotencyKey() {
    try {
      var k = sessionStorage.getItem(IDEM_KEY);
      if (k && /^[A-Za-z0-9_-]{8,80}$/.test(k)) return k;
      k = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID()
        : "ck-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(IDEM_KEY, k);
      return k;
    } catch (e) { return null; }
  }
  function clearIdempotencyKey() { try { sessionStorage.removeItem(IDEM_KEY); } catch (e) {} }

  function buildAddress() {
    var parts = [];
    var governorate = (document.getElementById("cust-governorate") || {}).value || "";
    var area = (document.getElementById("cust-area") || {}).value || "";
    var block = (document.getElementById("cust-block") || {}).value || "";
    var street = (document.getElementById("cust-street") || {}).value || "";
    var building = (document.getElementById("cust-building") || {}).value || "";
    var floor = (document.getElementById("cust-floor") || {}).value || "";
    var apartment = (document.getElementById("cust-apartment") || {}).value || "";
    var landmark = (document.getElementById("cust-landmark") || {}).value || "";
    if (governorate) parts.push("Governorate: " + locationDisplayName("gov", governorate));
    if (area) parts.push("Area: " + locationDisplayName("area", area));
    if (block) parts.push("Block: " + block);
    if (street) parts.push("Street: " + street);
    if (building) parts.push("Building: " + building);
    if (floor) parts.push("Floor: " + floor);
    if (apartment) parts.push("Apartment: " + apartment);
    if (landmark) parts.push("Landmark: " + landmark);
    return parts.join(", ");
  }

  /* Order summary — shipping follows the same threshold rule the server
     applies at order creation (below threshold → flat fee, otherwise free).
     Presentation only: the markup (styled by the #checkout-summary scoped
     block in checkout.html) shows Total = subtotal + shipping; the subtotal
     itself is intentionally not displayed. */
  function renderSummary() {
    var items = getCart();
    if (items.length === 0) return;
    var subtotal = items.reduce(function (s, i) { return s + (i.price * (i.quantity || 1)); }, 0);
    var shipping = shippingFor(subtotal);
    var total = subtotal + shipping;
    var summaryEl = document.getElementById("checkout-summary");
    if (!summaryEl) return;
    var html = '<div class="cs-top">' +
      '<button type="button" id="edit-cart-items-btn" class="cs-edit-btn">' +
        '<span class="material-symbols-outlined" aria-hidden="true">shopping_cart</span>' +
        '<span>Edit shopping cart items</span>' +
      '</button>' +
      '<div class="cs-divider" aria-hidden="true"></div>' +
      '<div class="cs-total">' +
        '<span class="cs-total-label">Total</span>' +
        '<span class="cs-total-value">' + formatKd(total) + '</span>' +
      '</div>' +
    '</div>';
    var __langAr = false; try { __langAr = localStorage.getItem('nassim-lang') === 'ar'; } catch (e) {}
    html += items.map(function (i) {
      var qty = i.quantity || 1;
      /* Arabic name when selected and present; graceful English fallback. */
      var __ar = i.nameAr;
      var dispName = (__langAr && typeof __ar === 'string' && __ar.trim()) ? __ar : String(i.name || '');
      var dirAttr = (__langAr && dispName && /[؀-ۿ]/.test(dispName)) ? ' dir="rtl"' : '';
      return '<div class="cs-item">' +
        '<div class="cs-thumb">' + (i.image ? '<img src="' + esc(i.image) + '" alt="" loading="lazy"/>' : '') + '</div>' +
        '<div class="cs-info">' +
          '<p class="cs-name"' + dirAttr + '>' + esc(dispName) + '</p>' +
          '<p class="cs-qty">Quantity: ' + qty + '</p>' +
          '<p class="cs-unit">' + formatKd(i.price, i.currency) + '/<span>piece</span></p>' +
        '</div>' +
        '<span class="cs-line-total">' + formatKd(i.price * qty, i.currency) + '</span>' +
      '</div>';
    }).join('');
    html += '<div class="cs-row"><span>Delivery</span><span class="cs-row-value">' + (shipping === 0 ? "Free" : formatKd(shipping)) + '</span></div>';
    /* Payment method — this phase is Cash on Delivery only (no online
       payment processing; cash is collected on delivery). Identified
       clearly here so the customer sees it before placing the order. */
    html += '<div class="cs-payment">' +
      '<div class="cs-payment-row">' +
        '<span class="cs-payment-label">Payment Method</span>' +
        '<span class="cs-payment-value"><span class="material-symbols-outlined" aria-hidden="true">payments</span>Cash on Delivery</span>' +
      '</div>' +
      '<p class="cs-pos-note">Final invoice is generated by our POS system. Total may vary based on actual delivered items.</p>' +
    '</div>';
    summaryEl.innerHTML = html;
    /* Direct navigation to the existing cart page — the cart is not read,
       cleared or rewritten here. The button is type="button" and lives
       outside the checkout <form>, so it can never submit the form. */
    var editBtn = document.getElementById("edit-cart-items-btn");
    if (editBtn) editBtn.addEventListener("click", function () { window.location.href = "cart.html"; });
  }

  function init() {
    var items = getCart();
    var subtotal = items.reduce(function (s, i) { return s + (i.price * (i.quantity || 1)); }, 0);

    // Redirect to cart if empty
    if (items.length === 0) {
      var main = document.querySelector("main");
      if (main) {
        main.innerHTML = '<div class="pt-32 pb-20 text-center max-w-md mx-auto"><div class="w-20 h-20 bg-surface-container dark:bg-surface-container-high rounded-full flex items-center justify-center mx-auto mb-6"><span class="material-symbols-outlined text-5xl text-on-surface-variant dark:text-white/70">shopping_cart</span></div><h1 class="font-headline text-2xl font-extrabold text-primary dark:text-white mb-4">Your cart is empty</h1><p class="text-on-surface-variant dark:text-white/70 mb-8">Add products before checking out.</p><a href="home5.html" class="inline-block bg-primary text-on-primary px-8 py-4 font-headline text-xs font-black uppercase tracking-[0.2em] rounded-sm hover:bg-secondary transition-all">Continue Shopping</a></div>';
      }
      return;
    }

    renderSummary();

    // Governorate → Area dependent dropdowns
    initLocationSelects();

    // Mobile input holds only the 8 local digits (+965 is a fixed, non-editable
    // prefix in the UI). Keep it digits-only, max 8, and if the customer pastes
    // a full +965-prefixed number, strip the country code instead of duplicating.
    (function () {
      var phoneEl = document.getElementById("cust-phone");
      if (!phoneEl) return;
      function currentDial() { return (phoneEl.dataset.dial || "965").replace(/\D/g, ""); }
      phoneEl.addEventListener("input", function () {
        var dial = currentDial();
        var max = dial === "965" ? 8 : 12;
        /* Strip the country code ONLY from a pasted international number
           (leading + or 00). Unconditional stripping would eat digits that
           legitimately start with the dial code (e.g. every Kazakh mobile
           starts with 7, the +7 dial digit). */
        var pastedIntl = /^\s*\+/.test(phoneEl.value) || /^\s*00/.test(phoneEl.value);
        var digits = phoneEl.value.replace(/\D/g, "");
        if (pastedIntl) digits = digits.replace(new RegExp("^(?:" + dial + ")"), "");
        digits = digits.slice(0, max);
        if (digits !== phoneEl.value) phoneEl.value = digits;
      });
    })();

    // Auto-populate form if logged in
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success && data.data && data.data.user) {
          var u = data.data.user;
          var banner = document.getElementById("logged-in-banner");
          if (banner) banner.classList.remove("hidden");
          var nameEl = document.getElementById("cust-name"); if (nameEl && !nameEl.value) nameEl.value = u.name || "";
          var phoneEl = document.getElementById("cust-phone"); if (phoneEl && !phoneEl.value) { var dial = (phoneEl.dataset.dial || "965").replace(/\D/g, ""); phoneEl.value = (u.phone || "").replace(/\D/g, "").replace(new RegExp("^(?:" + dial + ")"), "").slice(0, dial === "965" ? 8 : 12); }
          var emailEl = document.getElementById("cust-email"); if (emailEl && !emailEl.value) emailEl.value = u.email || "";
          // Try to load default address
          fetch("/api/addresses", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d.success && d.data && d.data.addresses && d.data.addresses.length > 0) {
                var addr = d.data.addresses.find(function (a) { return a.isDefault; }) || d.data.addresses[0];
                populateAddressFields(addr);
              }
            })
            .catch(function () {});
        }
      })
      .catch(function () {});

    // Handle form submit
    var form = document.getElementById("checkout-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (submitting) return; // Prevent double submission
        submitting = true;

        var btn = document.getElementById("place-order-btn");
        var btnText = btn ? btn.textContent : "";
        if (btn) { btn.textContent = "Placing Order…"; btn.disabled = true; btn.classList.add("opacity-60", "cursor-not-allowed"); }

        // Validate required fields
        var name = (document.getElementById("cust-name") || {}).value || "";
        var phone = (document.getElementById("cust-phone") || {}).value || "";
        var governorate = (document.getElementById("cust-governorate") || {}).value || "";
        var area = (document.getElementById("cust-area") || {}).value || "";
        var block = (document.getElementById("cust-block") || {}).value || "";
        var street = (document.getElementById("cust-street") || {}).value || "";

        var email = (((document.getElementById("cust-email") || {}).value || "").trim());
        var phoneEl = document.getElementById("cust-phone");
        var dial = ((phoneEl && phoneEl.dataset.dial) || "965").replace(/\D/g, "");
        var maxDigits = dial === "965" ? 8 : 12;
        // Field holds only the local digits (the calling code lives in the
        // country selector, surfaced via data-dial). If the customer pasted a
        // full international number (leading + or 00), strip the selected
        // country code first — never strip typed national digits (they can
        // legitimately start with the dial code, e.g. +7 Kazakh mobiles).
        var pastedIntl = /^\s*\+/.test(phone) || /^\s*00/.test(phone);
        var phoneDigits = phone.replace(/\D/g, "");
        if (pastedIntl) phoneDigits = phoneDigits.replace(new RegExp("^(?:" + dial + ")"), "");
        phoneDigits = phoneDigits.slice(0, maxDigits);
        if (phoneEl && phoneDigits !== phoneEl.value) phoneEl.value = phoneDigits;
        var phoneOk = dial === "965" ? /^\d{8}$/.test(phoneDigits) : /^\d{6,12}$/.test(phoneDigits);
        var phoneNormalized = "+" + dial + phoneDigits;
        var emailOk = !email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

        if (name.trim().length < 2) { showError("Please enter your full name.", document.getElementById("cust-name")); resetBtn(); return; }
        if (!phoneOk) { showError(dial === "965" ? "Please enter a valid Kuwaiti mobile number — exactly 8 digits after +965, e.g. 5512 3456." : "Please enter a valid mobile number for the selected country (+" + dial + ") — 6 to 12 digits.", phoneEl || document.getElementById("cust-phone")); resetBtn(); return; }
        if (!emailOk) { showError("Please enter a valid email address, or leave it empty.", document.getElementById("cust-email")); resetBtn(); return; }
        if (!governorate) { showError("Please select your Governorate.", document.getElementById("cust-governorate")); resetBtn(); return; }
        if (!area) { showError("Please select your Area.", document.getElementById("cust-area")); resetBtn(); return; }
        if (!block) { showError("Please fill in your Block number.", document.getElementById("cust-block")); resetBtn(); return; }
        if (!street) { showError("Please fill in your Street.", document.getElementById("cust-street")); resetBtn(); return; }
        if (items.length === 0) { showError("Your cart is empty."); resetBtn(); return; }

        var address = buildAddress();
        if (address.length < 3) { showError("Please provide delivery address details."); resetBtn(); return; }

        var body = {
          customerName: name,
          customerEmail: (document.getElementById("cust-email") || {}).value || "",
          customerPhone: phoneNormalized,
          address: address,
          // `area` is the dropdown's numeric ID (e.g. "2"); the server schema
          // requires city to be at least 2 characters, so send the Area's
          // display name instead of the raw ID.
          city: locationDisplayName("area", area) || area || "Kuwait",
          notes: "",
          items: items.map(function (i) { return { slug: i.id || i.slug, name: i.name, image: (i.image || ""), price: i.price, qty: i.quantity || 1 }; }),
          currency: "KD",
        };
        // NOTE: no `shipping` in the payload — the server computes the fee and
        // never trusts a client-sent financial value.

        var idemKey = getIdempotencyKey();
        var headers = { "Content-Type": "application/json" };
        if (idemKey) headers["x-idempotency-key"] = idemKey;

        fetch("/api/orders", { method: "POST", headers: headers, credentials: "same-origin", body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.success || data.error) {
              showError(data.error || "Could not place order. Please try again.");
              resetBtn();
              return;
            }
            // Optionally save address
            var saveAddr = document.getElementById("save-address");
            if (saveAddr && saveAddr.checked) {
              fetch("/api/addresses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                  label: "Checkout Address",
                  fullName: name,
                  phone: phone,
                  address: address,
                  city: area || "Kuwait",
                  area: area,
                  isDefault: true,
                })
              })
              .then(function (res) { return res.json().catch(function () { return { success: false }; }); })
              .then(function (j) {
                if (!j || !j.success) {
                  // The ORDER succeeded — only the convenience of saving the
                  // address failed. Tell the customer without alarming them.
                  var note = document.createElement("p");
                  note.className = "text-xs text-amber-600 mt-2";
                  note.textContent = "Note: we could not save this address to your account, but your order was placed successfully.";
                  var trackLink = document.querySelector('main a[href^="order-detail"]');
                  if (trackLink && trackLink.parentElement) trackLink.parentElement.insertBefore(note, trackLink);
                }
              })
              .catch(function () {});
            }
            // Clear cart
            try { localStorage.setItem(CART_KEY, JSON.stringify({ state: { items: [] } })); } catch (e) {}
            // Update cart badge globally
            if (window.NassimCartBadge) window.NassimCartBadge.update();
            // The order is committed — a future checkout must get a fresh idempotency key.
            clearIdempotencyKey();
            // Take the customer DIRECTLY to the Order Sent page (rendered by
            // the existing order page) — no intermediate confirmation screen
            // and no tracking step. New guest orders use the signed short
            // public link (/o/{id}-{signature}); the access token is never
            // placed in the customer-visible URL.
            // TEMP: routed to the new cart-styled Order Sent page
            // (order-send-modified.html). Previous destination (order-detail.html
            // via shortPath / number+token / id) is kept below for easy restore.
            var sentTarget = "order-send-modified2.html?number=" + encodeURIComponent(data.data.order.orderNumber) + (data.data.order.accessToken ? "&token=" + encodeURIComponent(data.data.order.accessToken) : "");
            /* var sentTarget = data.data.order.shortPath
              ? data.data.order.shortPath
              : data.data.order.accessToken
                ? "order-detail.html?number=" + encodeURIComponent(data.data.order.orderNumber) + "&token=" + encodeURIComponent(data.data.order.accessToken)
                : "order-detail.html?id=" + encodeURIComponent(data.data.order.id); */
            window.location.href = sentTarget;
          })
          .catch(function () {
            showError("Network error. Please check your connection and try again.");
            resetBtn();
          });

        function resetBtn() { submitting = false; if (btn) { btn.textContent = btnText; btn.disabled = false; btn.classList.remove("opacity-60", "cursor-not-allowed"); } }
        function showError(msg, fieldEl) {
          var errEl = document.getElementById("checkout-error");
          if (errEl) {
            errEl.textContent = msg;
            errEl.classList.remove("hidden");
            try { errEl.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
          } else { showToastFallback(msg, "error"); }
          if (fieldEl) {
            fieldEl.classList.add("ring-2", "ring-red-500", "border-red-500");
            /* 2026-10-25: scroll the invalid FIELD into view too — focus()
               alone scrolls the page for text inputs (mobile keyboard), but
               <select> dropdowns don't scroll on focus, so the user was left
               looking at the wrong part of the form. */
            try { fieldEl.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e1) {}
            try { fieldEl.focus({ preventScroll: true }); } catch (e2) { try { fieldEl.focus(); } catch (e4) {} }
            fieldEl.addEventListener("input", function clearMark() {
              fieldEl.classList.remove("ring-2", "ring-red-500", "border-red-500");
              fieldEl.removeEventListener("input", clearMark);
            });
          }
        }
        // Fallback notification when the #checkout-error banner is absent:
        // a self-contained, auto-dismissing toast (inline styles — never a
        // native alert(), whose dialog text exposes the server host).
        function showToastFallback(msg, type) {
          var existing = document.getElementById("checkout-toast-fallback");
          if (existing) existing.remove();
          var toast = document.createElement("div");
          toast.id = "checkout-toast-fallback";
          toast.setAttribute("role", type === "error" ? "alert" : "status");
          toast.textContent = msg;
          toast.style.cssText =
            "position:fixed;top:1.25rem;left:50%;transform:translateX(-50%);z-index:120;" +
            "max-width:min(92vw,26rem);background:#111d27;color:#fff;border:1px solid rgba(248,113,113,.4);" +
            "padding:.75rem 1rem;border-radius:.75rem;font-size:.8125rem;line-height:1.45;font-weight:500;" +
            "box-shadow:0 12px 40px rgba(0,3,8,.25);transition:opacity .35s ease;";
          document.body.appendChild(toast);
          setTimeout(function () {
            toast.style.opacity = "0";
            setTimeout(function () { if (toast.parentNode) toast.remove(); }, 380);
          }, 6500);
        }
      });
    }
  }

  function populateAddressFields(addr) {
    function set(id, val) { var el = document.getElementById(id); if (el && val) el.value = val; }
    /* Saved addresses predate the Governorate dropdown: its value is stored
       as plain text (e.g. "Hawalli"). Match against the stable ids first,
       then against the displayed names, and only select when a match exists. */
    var govSel = document.getElementById("cust-governorate");
    if (govSel) {
      var savedGov = (addr.governorate || "").toString().trim();
      var match = (NASSIM_CHECKOUT_LOCATIONS.governorates || []).find(function (g) {
        return g.id === savedGov || g.en === savedGov || g.ar === savedGov;
      });
      if (match) { govSel.value = match.id; populateAreaSelect(match.id); }
    }
    var areaSel = document.getElementById("cust-area");
    if (areaSel && !areaSel.disabled) {
      var savedArea = (addr.area || addr.city || "").toString().trim();
      var gov = findGovernorate(govSel ? govSel.value : "");
      var areaMatch = ((gov && gov.areas) || []).find(function (a) {
        return a.id === savedArea || a.en === savedArea || a.ar === savedArea;
      });
      if (areaMatch) areaSel.value = areaMatch.id;
    }
    set("cust-block", addr.block || "");
    set("cust-block", addr.block || "");
    set("cust-street", addr.street || "");
    set("cust-building", addr.building || "");
    set("cust-floor", addr.floor || "");
    set("cust-apartment", addr.apartment || "");
    set("cust-landmark", addr.landmark || "");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
