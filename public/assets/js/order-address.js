/* ============================================================================
   AL-NASSIM — shared delivery-address renderer for order sheets
   ============================================================================
   ONE implementation used by order-send-modified2.html (customer Order Sent),
   internal-orders2.html (staff View Order) and customer-order.html (the
   secure WhatsApp order page served by /o/{id}-{signature}).

   The checkout (assets/js/checkout.js → buildAddress()) stores the address
   as ONE comma-joined string in the existing order.address field:
     "Governorate: <gov>, Area: <area>, Block: …, Street: …, Building: …,
      Floor: …, Apartment: …, Landmark: …"
   The Governorate/Area VALUES are the exact display names saved at checkout
   (EN or AR, per the customer's checkout language). NOTHING is derived,
   inferred or mapped here — this file only splits that stored string into
   labeled rows so the sheet can show each field on its own line.

   Historical orders:
     - Orders placed before Governorate/Area existed carry either free text
       (no "Label:" prefixes at all) or the older "Area:/Block:/…" format —
       both render exactly as before: free text falls back to the legacy
       "address, city" string, and labeled fields simply show the rows that
       exist (no Governorate row is ever invented).
     - Values may contain commas (e.g. landmarks) — the splitter only breaks
       at commas that introduce a KNOWN label, so values are never cut.

   Arabic labels come ONLY from the approved central map (window.NASSIM_I18N,
   keys "governorate *", "area *", "block *", "street *", "building",
   "floor", "apartment", "landmark (optional)" — asterisks/optional markers
   stripped). Customer values are never translated and stay LTR-isolated.
   ========================================================================== */
(function () {
  'use strict';
  if (window.NassimOrderAddress) return; // idempotent

  /* Canonical display order — Governorate and Area at the TOP. */
  var FIELDS = [
    { key: 'Governorate', keys: ['governorate *', 'governorate'] },
    { key: 'Area', keys: ['area *', 'area'] },
    { key: 'Block', keys: ['block *', 'block'] },
    { key: 'Street', keys: ['street *', 'street'] },
    { key: 'Building', keys: ['building', 'building no.'] },
    { key: 'Floor', keys: ['floor'] },
    { key: 'Apartment', keys: ['apartment'] },
    { key: 'Landmark', keys: ['landmark (optional)', 'landmark'] }
  ];
  var SPLIT_RE = new RegExp(
    '(^|,)\\s*(' + FIELDS.map(function (f) { return f.key; }).join('|') + ')\\s*:', 'gi');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* Values (and phone-like content) stay isolated LTR inside AR rows. */
  function ltr(v) { return '<span dir="ltr" style="unicode-bidi:isolate;">' + v + '</span>'; }
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* ======================================================================
     Governorate / Area VALUE language resolution.
     The checkout stores the location's DISPLAY NAME with the order (en or
     ar, per the checkout language). To follow the live EN/AR toggle, the
     stored value is matched — EXACTLY, after the same normalization used
     everywhere else (NFC + whitespace collapse + case-fold; no fuzzy
     matching, no per-name translations, no second dataset) — against the
     EXISTING checkout location data (window.NASSIM_CHECKOUT_LOCATIONS,
     assets/js/nassim-locations-data.js) to pick that entry's en/ar name.
     Values with no exact dataset match (historical free text, renamed or
     removed entries) are displayed EXACTLY as stored — never guessed.
     Customer-entered fields (Block/Street/…) never go through this.
     ====================================================================== */
  var LOC_INDEX = { Governorate: null, Area: null };
  function locationIndex(kind) {
    if (LOC_INDEX[kind]) return LOC_INDEX[kind];
    var map = new Map();
    var data = window.NASSIM_CHECKOUT_LOCATIONS;
    var add = function (en, ar) {
      /* exact-key index in BOTH languages so a stored EN name resolves to
         ar and a stored AR name resolves to en */
      if (en && !map.has(norm(en))) map.set(norm(en), { en: en, ar: ar || en });
      if (ar && !map.has(norm(ar))) map.set(norm(ar), { en: en || ar, ar: ar });
    };
    (data && data.governorates || []).forEach(function (g) {
      if (kind === 'Governorate') { add(g.en, g.ar); return; }
      (g.areas || []).forEach(function (a) { add(a.en, a.ar); });
    });
    LOC_INDEX[kind] = map;
    return map;
  }
  function locationValue(fieldKey, value) {
    if (fieldKey !== 'Governorate' && fieldKey !== 'Area') return value;
    var entry = locationIndex(fieldKey).get(norm(value));
    if (!entry) return value; /* no reliable identity — keep stored value */
    return (document.documentElement.lang === 'ar') ? (entry.ar || value) : (entry.en || value);
  }

  /* Approved Arabic term for a field label — read live from the central
     i18n map; falls back to the English label when unavailable. */
  function label(key, keys) {
    if (document.documentElement.lang !== 'ar' || !window.NASSIM_I18N) return key;
    for (var i = 0; i < keys.length; i++) {
      var v = window.NASSIM_I18N[norm(keys[i])];
      if (v) {
        /* strip required-asterisks and "(optional)" markers — the approved
           translations carry them; the sheet labels do not. */
        return v.replace(/\s*\*/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      }
    }
    return key;
  }

  /* Split the stored address string into { Field: value } pairs.
     Returns null when NO known label exists (legacy free-text order). */
  function parse(address) {
    var s = String(address || '');
    var found = {}, any = false, m;
    SPLIT_RE.lastIndex = 0;
    var marks = [];
    while ((m = SPLIT_RE.exec(s)) !== null) {
      marks.push({ start: m.index, sep: m[1], label: m[2], valueStart: m.index + m[0].length });
    }
    for (var i = 0; i < marks.length; i++) {
      var end = i + 1 < marks.length ? marks[i + 1].start : s.length;
      var value = s.slice(marks[i].valueStart, end).trim();
      if (!value) continue;
      found[marks[i].label.charAt(0).toUpperCase() + marks[i].label.slice(1).toLowerCase()] = value;
      any = true;
    }
    return any ? found : null;
  }

  /* Returns the HTML for the #os-address container of an order sheet.
     callers keep their existing card/line markup — only this content varies. */
  function renderHtml(order) {
    var o = order || {};
    var fields = parse(o.address);
    if (!fields) {
      /* Legacy free-text address — EXACTLY the previous display. */
      var text = esc(o.address || '');
      if (o.city) text += (text ? ', ' : '') + esc(o.city);
      return ltr(text);
    }
    var html = '';
    FIELDS.forEach(function (f) {
      var v = fields[f.key];
      if (!v) return;
      /* Governorate/Area values follow the active language via the existing
         checkout location data; all other fields render exactly as stored. */
      v = locationValue(f.key, v);
      html += '<div class="os-addr-row">' + esc(label(f.key, f.keys)) + ' : ' + ltr(esc(v)) + '</div>';
    });
    /* Structured orders without an Area row keep the legacy city suffix so
       no location information is lost; normal orders already carry the city
       as the Area row (checkout sets city = area). */
    if (!fields.Area && o.city) {
      html += '<div class="os-addr-row">' + ltr(esc(o.city)) + '</div>';
    }
    return html;
  }

  window.NassimOrderAddress = {
    renderHtml: renderHtml,
    /* Resolve ONE stored Governorate/Area value through the existing checkout
       location data into the ACTIVE language (en when document lang is en,
       ar when ar). Values with no exact dataset match come back untouched —
       same guarantee as renderHtml. Used by the staff orders LIST (the
       Area/Location column), whose stored city is the checkout display name. */
    resolveLocation: function (value) {
      var v = String(value == null ? '' : value);
      if (!v) return v;
      var entry = locationIndex('Area').get(norm(v));
      if (!entry) return v;
      return (document.documentElement.lang === 'ar') ? (entry.ar || v) : (entry.en || v);
    },
    /* True when the order carries structured (labeled) address fields —
       callers use this to hide the static "Address :" prefix. */
    isStructured: function (order) { return !!parse((order || {}).address); },

    /* Display formatting ONLY for a stored E.164 customerPhone
       ("+96555123456" → "+965 55123456"): inserts ONE space between the
       country calling code and the national number so staff can read the
       two apart. The boundary comes from the real calling-code lengths
       (1-digit: 1, 7; 2-digit set below; everything else 3-digit) — never a
       fixed digit count. The stored value and API payloads are untouched;
       anything that is not a "+<digits>" number (legacy entries) comes back
       exactly as stored. */
    formatPhone: function (phone) {
      var v = String(phone == null ? '' : phone).trim();
      var m = /^\+(\d{6,15})$/.exec(v.replace(/[\s()-]/g, ''));
      if (!m) return v;
      var d = m[1];
      var DIAL2 = {};
      "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98".split(' ').forEach(function (c) { DIAL2[c] = 1; });
      var dialLen = (d[0] === '1' || d[0] === '7') ? 1 : (DIAL2[d.slice(0, 2)] ? 2 : 3);
      return '+' + d.slice(0, dialLen) + ' ' + d.slice(dialLen);
    }
  };
})();
