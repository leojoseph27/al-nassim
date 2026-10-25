/**
 * AL-NASSIM Mobile Navigation
 * ============================================================================
 * Replaces the hamburger-slot placeholder with an animated hamburger icon,
 * creates a slide-out drawer with accordion department links, and adapts
 * the menu content based on auth state (guest vs logged-in).
 *
 * Category data is read from the existing desktop dropdown-trigger elements
 * in the DOM — no hardcoding. Auth state is read from window.NassimAccount
 * (exposed by account.js which loads before this script via defer).
 * ============================================================================
 */
(function () {
  "use strict";

  /* ---------- Inject accordion CSS ---------- */
  var style = document.createElement("style");
  style.id = "mobile-nav-accordion-style";
  style.textContent =
    ".mobile-accordion-body{max-height:0;overflow:hidden;transition:max-height .3s ease}" +
    ".mobile-accordion-body.open{max-height:300px}" +
    ".mobile-accordion-arrow{transition:transform .3s ease}" +
    ".mobile-accordion-arrow.open{transform:rotate(180deg)}";
  document.head.appendChild(style);

  /* ---------- DOM refs ---------- */
  var hamburgerSlot = null;   // the <button id="hamburger-slot"> in the nav
  var overlay       = null;   // backdrop
  var drawer        = null;   // slide-out panel
  var isOpen        = false;
  var categories    = [];     // parsed from desktop dropdowns

  /* ---------- Parse categories from desktop nav ---------- */
  function extractNavLinkName(link) {
    /* Desktop nav links have the form:
         <a href="…">Houseware<br/><span class="block text-[11px]">Equipment</span></a>
       Extract both parts explicitly from child nodes to avoid innerText/textContent
       issues where <br/> may or may not produce a separator. */
    var parts = [];
    for (var c = 0; c < link.childNodes.length; c++) {
      var node = link.childNodes[c];
      if (node.nodeType === 3) { // TEXT_NODE
        var t = node.textContent.trim();
        if (t) parts.push(t);
      } else if (node.nodeType === 1) { // ELEMENT_NODE
        var t = node.textContent.trim();
        if (t) parts.push(t);
      }
      // skip <br/> nodes (nodeType 1 with tagName BR, no textContent)
    }
    return parts.join(" ");
  }

  function parseCategories() {
    categories = [];
    var triggers = document.querySelectorAll(".dropdown-trigger");
    for (var i = 0; i < triggers.length; i++) {
      var trigger = triggers[i];
      var link = trigger.querySelector("a");
      if (!link) continue;
      var subcats = [];
      var subLinks = trigger.querySelectorAll(".dropdown-menu > ul > li > a");
      for (var j = 0; j < subLinks.length; j++) {
        // strip the desktop submenu arrow glyph so mobile labels are unchanged
        subcats.push({ name: subLinks[j].textContent.replace(/\u203a/g, "").trim(), href: subLinks[j].href });
      }
      categories.push({ name: extractNavLinkName(link), href: link.href, subcats: subcats });
    }
    // Also pick up plain nav links (no dropdown) in the same container
    var navLinks = document.querySelectorAll(".dropdown-trigger");
    var lastTrigger = navLinks.length > 0 ? navLinks[navLinks.length - 1] : null;
    if (lastTrigger) {
      var sibling = lastTrigger.nextElementSibling;
      while (sibling) {
        if (sibling.tagName === "A" && !sibling.classList.contains("dropdown-trigger")) {
          categories.push({ name: extractNavLinkName(sibling), href: sibling.href, subcats: [] });
        }
        sibling = sibling.nextElementSibling;
      }
    }
  }

  /* ---------- Build auth section HTML ---------- */
  function buildAuthHTML() {
    var user = (window.NassimAccount && window.NassimAccount.getCurrentUser) ? window.NassimAccount.getCurrentUser() : null;
    var html = '<nav class="px-5 pt-2 pb-3 space-y-1">';

    if (user) {
      // Logged-in: Shopping Cart, Wishlist, Track Order, Logout
      html += linkHTML("cart.html", "shopping_cart", "Shopping Cart");
      html += linkHTML("wishlist.html", "favorite", "Wishlist");
      html += linkHTML("order-detail.html", "track_changes", "Track Order");
      html += '<button class="mobile-nav-logout flex items-center gap-3 w-full py-3 px-3 rounded-lg text-sm font-bold text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">';
      html += '<span class="material-symbols-outlined text-lg">logout</span> Logout</button>';
    } else {
      // Guest: Login / Sign In
      html += '<button class="mobile-nav-login flex items-center gap-3 w-full py-3 px-3 rounded-lg text-sm font-bold text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">';
      html += '<span class="material-symbols-outlined text-lg">login</span> Login / Sign In</button>';
    }

    html += '</nav>';
    return html;
  }

  /* ---------- Helper: nav link HTML ---------- */
  function linkHTML(href, icon, label) {
    return '<a href="' + href + '" class="flex items-center gap-3 py-3 px-3 rounded-lg text-sm font-bold text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">' +
      '<span class="material-symbols-outlined text-lg">' + icon + '</span> ' + label + '</a>';
  }

  /* ---------- Build departments accordion HTML ---------- */
  function buildDepartmentsHTML() {
    var html = '<div class="px-5 py-2">';
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      /* 2026-10-25: departments WITHOUT subcategories (Packaging Manufacturer,
         Cold Rooms) render as plain links — no accordion arrow, tapping goes
         to the department page. Only real accordions get the arrow. */
      if (!cat.subcats || cat.subcats.length === 0) {
        html += '<a href="' + cat.href + '" class="mobile-plain-link flex items-center justify-between w-full py-3 px-3 rounded-lg text-sm font-bold text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">';
        var plainParts = cat.name.split(/\s+/);
        html += '<span class="flex flex-col items-start leading-tight">';
        for (var pp = 0; pp < plainParts.length; pp++) {
          if (pp > 0) html += '<span class="text-[11px] font-semibold text-gray-500 dark:text-gray-400">' + plainParts[pp] + '</span>';
          else html += '<span>' + plainParts[pp] + '</span>';
        }
        html += '</span></a>';
        continue;
      }
      html += '<div class="mobile-accordion-item mb-1">';
      // Header row
      html += '<button class="mobile-accordion-trigger flex items-center justify-between w-full py-3 px-3 rounded-lg text-sm font-bold text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-index="' + i + '">';
      var parts = cat.name.split(/\s+/);
      html += '<span class="flex flex-col items-start leading-tight">';
      for (var p = 0; p < parts.length; p++) {
        if (p > 0) html += '<span class="text-[11px] font-semibold text-gray-500 dark:text-gray-400">' + parts[p] + '</span>';
        else html += '<span>' + parts[p] + '</span>';
      }
      html += '</span>';
      html += '<span class="material-symbols-outlined text-base text-gray-400 dark:text-gray-500 mobile-accordion-arrow">expand_more</span>';
      html += '</button>';
      // Collapsible body
      html += '<div class="mobile-accordion-body">';
      html += '<div class="pl-3 pb-2 space-y-1">';
      for (var j = 0; j < cat.subcats.length; j++) {
        html += '<a href="' + cat.subcats[j].href + '" class="block py-2 px-3 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">' + cat.subcats[j].name + '</a>';
      }
      html += '</div></div></div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- Render drawer content ---------- */
  function renderDrawer() {
    parseCategories();
    var deptEl = document.getElementById("mobile-nav-departments");
    if (deptEl) deptEl.innerHTML = buildDepartmentsHTML();
    wireDrawerEvents();
  }

  /* ---------- Wire drawer events (accordion + login + logout) ---------- */
  function wireDrawerEvents() {
    // Accordion toggles
    var triggers = drawer.querySelectorAll(".mobile-accordion-trigger");
    for (var i = 0; i < triggers.length; i++) {
      (function(trigger) {
        trigger.addEventListener("click", function () {
          var body = trigger.nextElementSibling;
          var arrow = trigger.querySelector(".mobile-accordion-arrow");
          if (!body) return;
          var isOpen = body.classList.contains("open");
          // Close all others
          var allBodies = drawer.querySelectorAll(".mobile-accordion-body");
          var allArrows = drawer.querySelectorAll(".mobile-accordion-arrow");
          for (var k = 0; k < allBodies.length; k++) {
            allBodies[k].classList.remove("open");
            allArrows[k].classList.remove("open");
          }
          // Toggle current
          if (!isOpen) {
            body.classList.add("open");
            if (arrow) arrow.classList.add("open");
          }
        });
      })(triggers[i]);
    }

    // Login button → open existing auth panel
    var loginBtn = drawer.querySelector(".mobile-nav-login");
    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        closeMenu();
        if (window.NassimAccount && window.NassimAccount.openPanel) {
          window.NassimAccount.openPanel();
        }
      });
    }

    // Logout button → call existing logout
    var logoutBtn = drawer.querySelector(".mobile-nav-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        closeMenu();
        if (window.NassimAccount && window.NassimAccount.logout) {
          window.NassimAccount.logout();
        }
      });
    }

    // All links → close menu on tap
    drawer.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", closeMenu);
    });
  }

  /* ---------- Open / Close ---------- */
  function openMenu() {
    isOpen = true;
    renderDrawer(); // re-read categories + auth state each time
    overlay.classList.remove("opacity-0", "invisible");
    drawer.classList.remove("translate-x-full");
    // Animate hamburger bars to X
    var b1 = document.getElementById("mob-bar1");
    var b2 = document.getElementById("mob-bar2");
    var b3 = document.getElementById("mob-bar3");
    if (b1) b1.style.transform = "rotate(45deg) translate(5px, 5px)";
    if (b2) b2.style.opacity = "0";
    if (b3) b3.style.transform = "rotate(-45deg) translate(7px, -7px)";
    document.body.style.overflow = "hidden";
  }

  function closeMenu() {
    isOpen = false;
    overlay.classList.add("opacity-0", "invisible");
    drawer.classList.add("translate-x-full");
    var b1 = document.getElementById("mob-bar1");
    var b2 = document.getElementById("mob-bar2");
    var b3 = document.getElementById("mob-bar3");
    if (b1) b1.style.transform = "";
    if (b2) b2.style.opacity = "";
    if (b3) b3.style.transform = "";
    document.body.style.overflow = "";
  }

  /* ---------- Init ---------- */
  function init() {
    // Prevent double-init
    if (document.getElementById("mobile-nav-drawer")) return;
    var nav = document.querySelector("nav");
    if (!nav) return;

    // --- Hijack hamburger slot ---
    hamburgerSlot = document.getElementById("hamburger-slot");
    if (!hamburgerSlot) return; // no slot = no mobile nav needed
    hamburgerSlot.innerHTML =
      '<span class="block w-5 h-0.5 bg-primary dark:bg-white transition-all duration-300 origin-center" id="mob-bar1"></span>' +
      '<span class="block w-5 h-0.5 bg-primary dark:bg-white transition-all duration-300 origin-center" id="mob-bar2"></span>' +
      '<span class="block w-5 h-0.5 bg-primary dark:bg-white transition-all duration-300 origin-center" id="mob-bar3"></span>';
    hamburgerSlot.className = hamburgerSlot.className.replace("md:hidden", "") + " md:hidden flex flex-col gap-[5px] p-2 justify-center items-center";

    // --- Create overlay ---
    overlay = document.createElement("div");
    overlay.id = "mobile-nav-overlay";
    overlay.className = "fixed inset-0 bg-black/50 z-[70] opacity-0 invisible transition-all duration-300 md:hidden";
    document.body.appendChild(overlay);

    // --- Create drawer ---
    drawer = document.createElement("div");
    drawer.id = "mobile-nav-drawer";
    drawer.className = "fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-white dark:bg-gray-900 z-[80] shadow-2xl translate-x-full transition-transform duration-300 overflow-y-auto md:hidden";
    drawer.innerHTML =
      '<div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">' +
      '  <img src="LOGO-mobile.webp" alt="AL-NASSIM" class="h-10 w-auto"/>' +
      '  <button id="mobile-nav-close" class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" aria-label="Close menu">' +
      '    <span class="material-symbols-outlined text-gray-600 dark:text-gray-300">close</span>' +
      '  </button>' +
      '</div>' +
      '<div id="mobile-nav-departments"></div>';
    document.body.appendChild(drawer);

    // --- Keep duplicate utility controls out of the drawer -------------------
    // Language / Download App / Dark-Light mode now live permanently in the
    // TOP NAVBAR (dark-overrides.js #nassim-mobile-utils row). Some pages
    // inject a legacy #mobile-nav-utilities block (the same three controls)
    // into this shared drawer and flip it into a "utilities-only" mode that
    // hides the departments. Strip that block and keep the categories
    // visible, wherever page scripts re-add or re-hide them. Only the
    // duplicate UI entries are removed — the navbar controls and all drawer
    // functionality (categories, subcategories, login/logout) are untouched.
    function stripDuplicateUtilities() {
      var util = document.getElementById("mobile-nav-utilities");
      if (util) util.remove();
      var dept = document.getElementById("mobile-nav-departments");
      if (dept && dept.style.display === "none") dept.style.display = "";
    }
    stripDuplicateUtilities();
    if (window.MutationObserver) {
      new MutationObserver(stripDuplicateUtilities).observe(drawer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"]
      });
    }

    // --- Event listeners ---
    hamburgerSlot.addEventListener("click", function () { isOpen ? closeMenu() : openMenu(); });
    overlay.addEventListener("click", closeMenu);
    var closeBtn = document.getElementById("mobile-nav-close");
    if (closeBtn) closeBtn.addEventListener("click", closeMenu);

    // Pre-render so drawer has content on first open
    parseCategories();
    var deptEl = document.getElementById("mobile-nav-departments");
    if (deptEl) deptEl.innerHTML = buildDepartmentsHTML();
    wireDrawerEvents();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
