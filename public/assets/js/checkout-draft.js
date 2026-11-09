/* ===== Checkout draft preservation (cart ↔ checkout navigation) ===========
   Saves the checkout form's customer + delivery fields on every change and
   restores them when checkout5.html loads, so editing the cart
   (cart.html) or refreshing the page never loses entered information.

   Storage: sessionStorage["nassim_checkout_draft"] — deliberately session-
   scoped (the current checkout session), never URLs, no payment/auth data,
   and completely separate from the cart storage (localStorage nassim_cart).

   Restore rules:
     - runs AFTER checkout.js's own initializers (location dropdowns,
       logged-in autofill, phone country selector) and only fills values
       that exist in the draft — empty defaults never overwrite anything;
     - the phone is restored together with its selected country
       (data-dial / data-iso / data-cname + visible flag/code), keeping the
       national digits only — the country code is never duplicated;
     - Governorate is re-selected and the Area list repopulated through the
       page's existing change handler before the Area value is applied;
     - re-applied after a language switch (nassim-langchange rebuilds the
       Governorate/Area option lists) for both EN and AR.

   Cleared ONLY after a successful order submission (checkout.js removes
   the draft next to its nassim_order_done flag) or an explicit form reset. */
(function () {
  "use strict";

  var KEY = "nassim_checkout_draft";
  var TEXT_FIELDS = [
    "cust-name", "cust-email",
    "cust-block", "cust-street", "cust-building",
    "cust-floor", "cust-apartment", "cust-landmark"
  ];
  var SELECT_FIELDS = ["cust-country", "cust-governorate", "cust-area"];
  var restoring = false;

  function readDraft() {
    try {
      var raw = sessionStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : null;
      return d && typeof d === "object" ? d : null;
    } catch (e) { return null; }
  }
  function writeDraft(d) {
    try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* storage unavailable */ }
  }
  /* An order has been committed in this tab (checkout.js sets this flag the
     moment the backend confirms). After it, the draft must never be written
     again — the success redirect's pagehide would otherwise re-persist the
     just-cleared draft — nor restored into a new checkout. */
  function orderCommitted() {
    try { return sessionStorage.getItem("nassim_order_done") === "1"; } catch (e) { return false; }
  }

  function collect() {
    var d = { v: 1, fields: {}, phone: null };
    TEXT_FIELDS.concat(SELECT_FIELDS).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) d.fields[id] = el.value || "";
    });
    var phone = document.getElementById("cust-phone");
    if (phone) {
      d.phone = {
        value: phone.value || "",
        dial: phone.dataset.dial || "965",
        iso: phone.dataset.iso || "KW",
        cname: phone.dataset.cname || "Kuwait"
      };
    }
    return d;
  }

  function save() {
    if (restoring || orderCommitted()) return;
    var next = collect();
    /* Governorate/Area are transiently reset to their placeholder whenever
       the language re-render rebuilds their option lists (checkout.js
       populate*, during load-time i18n init AND live langchange). That empty
       snapshot must never downgrade a real saved selection — it is the
       mobile "switch language and the Area resets" bug. Non-empty values
       always save normally. */
    var prev = readDraft();
    if (prev && prev.fields) {
      if (!next.fields["cust-area"] && prev.fields["cust-area"]) next.fields["cust-area"] = prev.fields["cust-area"];
      if (!next.fields["cust-governorate"] && prev.fields["cust-governorate"]) next.fields["cust-governorate"] = prev.fields["cust-governorate"];
    }
    writeDraft(next);
  }

  function clear() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  /* ---- restore (after checkout.js + location lists are ready) ---- */
  function setIf(el, value) {
    if (!el || value === undefined || value === null || value === "") return false;
    el.value = value;
    return true;
  }
  function flagEmoji(iso) {
    try {
      return String.fromCodePoint.apply(null, [].map.call(String(iso), function (c) {
        return 127397 + c.charCodeAt(0);
      }));
    } catch (e) { return "🏳️"; }
  }

  function applyPhone(d) {
    var phone = document.getElementById("cust-phone");
    if (!phone || !d.phone) return;
    var p = d.phone;
    if (p.value !== undefined && p.value !== null) phone.value = p.value; // national digits only — never a duplicated code
    if (p.dial) phone.dataset.dial = p.dial;
    if (p.iso) phone.dataset.iso = p.iso;
    if (p.cname) phone.dataset.cname = p.cname;
    phone.maxLength = p.dial === "965" ? 8 : 12;
    var flagEl = document.getElementById("cc-flag");
    var codeEl = document.getElementById("cc-code");
    if (flagEl && p.iso) flagEl.textContent = flagEmoji(p.iso);
    if (codeEl && p.dial) codeEl.textContent = "+" + p.dial;
  }

  function applyLocationSelects(d) {
    var govSel = document.getElementById("cust-governorate");
    if (!govSel) return;
    var savedGov = (d.fields && d.fields["cust-governorate"]) || "";
    var savedArea = (d.fields && d.fields["cust-area"]) || "";
    if (savedGov && govSel.querySelector('option[value="' + savedGov + '"]')) {
      if (govSel.value !== savedGov) {
        govSel.value = savedGov;
        // Rebuild the Area list through the page's own change handler
        // (checkout.js listens for this and repopulates the dependent list).
        govSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      var areaSel = document.getElementById("cust-area");
      if (areaSel && savedArea && areaSel.querySelector('option[value="' + savedArea + '"]')) {
        areaSel.value = savedArea;
      }
    }
  }

  function restore() {
    if (orderCommitted()) return; // a finished order must not leak into a new checkout
    var d = readDraft();
    if (!d) return;
    restoring = true;
    try {
      TEXT_FIELDS.concat(["cust-country"]).forEach(function (id) {
        setIf(document.getElementById(id), d.fields ? d.fields[id] : "");
      });
      applyPhone(d);
      applyLocationSelects(d);
    } finally {
      restoring = false;
    }
  }

  /* Wipe the visible form back to empty defaults — used ONLY when a
     back/forward (bfcache) restore brings back a checkout page whose order
     was already committed and whose draft is gone. The restored DOM still
     paints the previous customer's values; leaving them visible would let a
     stray tap re-save them into a new session. Country resets to its
     default (Kuwait), Governorate/Area to their placeholders. */
  function clearFormFields() {
    restoring = true;
    try {
      TEXT_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = "";
      });
      var ph = document.getElementById("cust-phone");
      if (ph) {
        ph.value = "";
        ph.dataset.dial = "965";
        ph.dataset.iso = "KW";
        ph.dataset.cname = "Kuwait";
        ph.maxLength = 8;
        var flagEl = document.getElementById("cc-flag");
        var codeEl = document.getElementById("cc-code");
        if (flagEl) flagEl.textContent = "🇰🇼";
        if (codeEl) codeEl.textContent = "+965";
      }
      var country = document.getElementById("cust-country");
      if (country && country.querySelector('option[value="KW"]')) country.value = "KW";
      var gov = document.getElementById("cust-governorate");
      if (gov) { gov.value = ""; gov.dispatchEvent(new Event("change", { bubbles: true })); }
    } finally {
      restoring = false;
    }
  }

  /* Location dropdowns are populated by checkout.js on DOMContentLoaded;
     wait until the Governorate options exist, then restore. Bounded retry —
     never blocks the page if the locations data failed to load. */
  function restoreWhenReady(tries) {
    var govSel = document.getElementById("cust-governorate");
    if (govSel && govSel.options.length > 1) {
      restore();
      return;
    }
    if (tries > 50) return; // ~5s — give up silently
    setTimeout(function () { restoreWhenReady(tries + 1); }, 100);
  }

  /* ---- wiring ---- */
  function init() {
    // Save on every field change (delegated: inputs, selects, phone country).
    document.addEventListener("input", function (e) {
      var el = e.target;
      if (!el || !el.id) return;
      if (TEXT_FIELDS.indexOf(el.id) !== -1 || el.id === "cust-phone" || el.id === "cc-search") {
        if (el.id !== "cc-search") save();
      }
    }, true);
    document.addEventListener("change", function (e) {
      var el = e.target;
      if (!el || !el.id) return;
      if (TEXT_FIELDS.indexOf(el.id) !== -1 || SELECT_FIELDS.indexOf(el.id) !== -1 || el.id === "cust-phone") save();
    }, true);
    // Safety: capture in-flight edits right before leaving for the cart.
    window.addEventListener("pagehide", save);

    // Language switch rebuilds the Governorate/Area option lists — re-apply
    // the saved selections so AR/EN toggling never loses them. The re-apply
    // runs save-suppressed: rebuilding the Area list fires change events
    // while Area is transiently empty, and saving that snapshot would
    // overwrite the good draft value (the mobile "language switch clears
    // the Area" bug).
    window.addEventListener("nassim-langchange", function () {
      var d = readDraft();
      if (!d) return;
      setTimeout(function () {
        restoring = true;
        try { applyLocationSelects(d); } finally { restoring = false; }
      }, 50);
    });

    // Explicit reset clears the draft (clearing = the customer's intent).
    var form = document.getElementById("checkout-form");
    if (form) form.addEventListener("reset", clear);

    /* Back/Forward (bfcache) restore: the browser can bring back a checkout
       page whose order was already committed — its DOM still shows the
       previous customer's values. With the draft gone they must be wiped
       (a live draft is re-applied instead). checkout5.html's own guard
       handles the still-committed-session case by redirecting home. */
    window.addEventListener("pageshow", function (e) {
      if (orderCommitted()) return;
      if (e.persisted) {
        if (readDraft()) restore();
        else clearFormFields();
      }
    });

    restoreWhenReady(0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* Exposed for the order-success path and any future explicit reset UI. */
  window.NassimCheckoutDraft = { clear: clear, save: save };
})();
