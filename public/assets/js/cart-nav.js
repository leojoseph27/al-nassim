/**
 * AL-NASSIM Cart Navigation + Global Badge Sync (Sprint 5)
 * ============================================================================
 * - Wires the cart icon in the header to navigate to cart.html.
 * - Provides a single source of truth for the cart badge count.
 * - Exposes window.NassimCartBadge.update() for any script to call after
 *   modifying the cart (add, remove, quantity change, merge, checkout).
 * - On page load, reads the cart from localStorage (guest) or /api/cart
 *   (logged in) and sets the badge.
 * - Listens to the 'storage' event for cross-tab synchronisation.
 *
 * Include on every page: <script src="assets/js/cart-nav.js"></script>
 * ============================================================================
 */
(function () {
  "use strict";

  var CART_KEY = "nassim_cart";

  function readLocalCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      if (!raw) return [];
      var p = JSON.parse(raw);
      var state = p && p.state ? p.state : p;
      return state && state.items ? state.items : [];
    } catch (e) {
      return [];
    }
  }

  function countItems(items) {
    return items.reduce(function (sum, item) {
      return sum + (item.quantity || 1);
    }, 0);
  }

  function setBadge(count) {
    // Desktop header badges (.nassim-cart-badge) and the mobile bottom-nav
    // badge (#header-cart-count) are kept in sync together; visibility is
    // driven here so the desktop badge needs no per-page wiring.
    var badges = document.querySelectorAll(".nassim-cart-badge, #header-cart-count");
    var text = String(count);
    badges.forEach(function (el) {
      el.textContent = text;
      el.style.display = count > 0 ? "flex" : "none";
    });
  }

  var CartBadge = {
    /**
     * Re-reads the cart and updates the badge. Call this after ANY cart
     * mutation: add, remove, quantity update, checkout, login, logout, merge.
     */
    update: function () {
      // First check localStorage (guest cart)
      var localItems = readLocalCart();
      var localCount = countItems(localItems);

      // If the user is logged in, try the server cart for the authoritative count
      fetch("/api/auth/me", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success && data.data && data.data.user && !data.data.guest) {
            // Logged in — read server cart
            fetch("/api/cart", { credentials: "same-origin" })
              .then(function (r) { return r.json(); })
              .then(function (cartData) {
                if (cartData.success && cartData.data && cartData.data.items) {
                  setBadge(countItems(cartData.data.items));
                } else {
                  setBadge(localCount);
                }
              })
              .catch(function () { setBadge(localCount); });
          } else {
            // Guest — use localStorage
            setBadge(localCount);
          }
        })
        .catch(function () { setBadge(localCount); });
    }
  };

  function init() {
    // Wire cart icon click
    var buttons = document.querySelectorAll("header button, nav button, header a, nav a");
    for (var i = 0; i < buttons.length; i++) {
      var icon = buttons[i].querySelector(".material-symbols-outlined");
      if (icon && icon.textContent.trim() === "shopping_cart") {
        var btn = buttons[i];
        if (btn.dataset.cartWired) continue;
        btn.dataset.cartWired = "1";
        btn.style.cursor = "pointer";
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          /* Deliberate "open cart" navigation = the customer is starting a
             new shopping session. Clear the completed-order flag (even when
             the cart is empty) and mark the intent so cart.html's guard
             lets this load through. */
          try {
            sessionStorage.setItem("nassim_new_cart_session", "1");
            sessionStorage.removeItem("nassim_order_done");
          } catch (err) {}
          window.location.href = "cart.html";
        });
        break;
      }
    }

    // Initial badge update
    CartBadge.update();

    /* Language passport cleanup: the one-shot order sheet sets
       nassim_sheet_lang_ok when the customer deliberately reloads it via a
       language switch. That permission is valid only while the sheet is the
       current page — clear it on every OTHER page so Back/Forward/refresh
       can never reuse it to reopen the sheet. */
    if (location.pathname.indexOf('order-send-modified4.html') === -1) {
      try { sessionStorage.removeItem('nassim_sheet_lang_ok'); } catch (e) {}
    }

    /* Completed-order guard chokepoint: EVERY local cart write passes
       through localStorage.setItem. A write that stores items means the
       customer deliberately added products — a NEW shopping session, so
       reopen cart/checkout access. Writes that store an EMPTY cart (order
       completion, checkout.js) keep the completed-session flag. Badge-only
       updates (e.g. a logged-in server cart) never touch the flag, so a
       finished session can't be unlocked by a stale server cart count. */
    try {
      var rawSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key, value) {
        if (key === "nassim_cart" && typeof value === "string" && value.indexOf('"items":[{"') !== -1) {
          try { sessionStorage.removeItem("nassim_order_done"); } catch (e2) {}
        }
        return rawSetItem(key, value);
      };
    } catch (e) {}

    // Cross-tab synchronisation
    window.addEventListener("storage", function (e) {
      if (e.key === CART_KEY) {
        CartBadge.update();
      }
    });

    // Update badge when returning to the page (back/forward navigation)
    window.addEventListener("pageshow", function () {
      CartBadge.update();
    });

    /* Any LINK click that navigates to cart.html (mobile bottom navs, footer
       links) is likewise a deliberate cart visit: mark the new session and
       clear the completed-order flag before the navigation happens. Capture
       phase so this runs even if another handler stops propagation. */
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href*="cart.html"]') : null;
      if (!a) return;
      try {
        sessionStorage.setItem("nassim_new_cart_session", "1");
        sessionStorage.removeItem("nassim_order_done");
      } catch (err) {}
    }, true);
  }

  // Expose globally so other scripts can call NassimCartBadge.update()
  window.NassimCartBadge = CartBadge;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
