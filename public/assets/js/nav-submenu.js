/**
 * AL-NASSIM Houseware cascading nav (single expanding container)
 * ============================================================================
 * Enhances the desktop department dropdowns (Houseware, Supermarket,
 * Warehouse) so that hovering a category smoothly expands THE SAME dropdown
 * container toward the right, revealing that category's subcategories in the
 * newly opened area:
 *
 *   Cleaning Tools  -> Surface Cleaning, Toilet & Drain
 *   Home & Outdoor  -> Laundry Essentials, Storage and Packaging,
 *                      Camping Supplies (renamed from Picnic Collection)
 *   Kitchenware     -> Cutlery & Cleaver, Cooking & Utensils
 *
 * (Only subcategories that already exist in the project taxonomy are used —
 *  same names/slugs the category pages filter by.)
 *
 * HOW IT WORKS
 *   - A .hw-subpanel region is appended INSIDE the existing .dropdown-menu
 *     (so it is part of the same hover area/DOM subtree — the dropdown can
 *     never collapse while the cursor is over the expanded portion).
 *   - The panel is anchored left:100% and its width animates 0 -> 240px,
 *     so the container visually expands as one unified panel (no second
 *     floating box, no page layout shift — it is absolutely positioned).
 *   - One subset is visible at a time; hovering another category replaces
 *     the contents immediately. Pure CSS :hover geometry does the desktop
 *     work; JS only switches the active subset (a few lines).
 *   - Supermarket/Warehouse dropdowns are NOT touched.
 *   - Mobile: intentionally NOT applied — mobile-nav.js reads only the
 *     original top-level dropdown links, so the mobile drawer keeps its
 *     existing categories exactly as before (no hover dependency).
 *
 * NON-INVASIVE: injects one <style> + the subpanel markup at runtime; the
 * existing navbar HTML, URLs, hover behavior and layout are untouched.
 * ============================================================================
 */
(function () {
  "use strict";

  /* Subcategories that actually exist in the project taxonomy.
     Keys are the existing parent category page URLs; slugs use the same
     slugify scheme as the category pages' own filter buttons. */
  var SUBCATS = {
    "houseware-cleaning-tools.html": [
      { name: "Surface Cleaning", slug: "surface-cleaning" },
      { name: "Toilet supplies", slug: "toilet-drain" }
    ],
    "houseware-home-outdoor.html": [
      { name: "Laundry Essentials", slug: "laundry-essentials" },
      { name: "Storage and Packaging", slug: "storage-and-packaging" },
      { name: "Camping Supplies", slug: "picnic-collection" }
    ],
    "houseware-kitchenware.html": [
      { name: "Cutlery & Cleaver", slug: "cutlery-cleaver" },
      { name: "Cooking & Utensils", slug: "cooking-utensils" },
      { name: "Drinkware", slug: "drinkware" }
    ],
    "supermarket-cooling-appliances.html": [
      { name: "Freezer", slug: "freezer" },
      { name: "Cooler & Chiller", slug: "cooler-chiller" }
    ],
    "supermarket-trolleys-baskets.html": [
      { name: "Trolly", slug: "trolly" },
      { name: "Basket", slug: "basket" }
    ],
    "supermarket-shelves-stands.html": [
      { name: "Shelves", slug: "shelves" },
      { name: "Stands", slug: "stands" }
    ],
    "warehouse-trolleys-baskets.html": [
      { name: "Trolleys", slug: "trolleys" },
      { name: "Baskets", slug: "baskets" }
    ],
    "warehouse-forklifts-pallets.html": [
      { name: "Forklift", slug: "forklift" },
      { name: "Pallet", slug: "pallet" }
    ]
  };

  var CSS = [
    "/* Injected by nav-submenu.js — Houseware single expanding dropdown */",
    ".hw-menu{transition:border-radius .2s ease}",
    ".hw-menu.hw-expanded{border-top-right-radius:0;border-bottom-right-radius:0;border-right-color:transparent}",
    ".hw-subpanel{position:absolute;left:100%;top:0;bottom:0;width:0;overflow:hidden;",
    "margin:0;padding:0;z-index:70;background:inherit;",
    "transition:width .22s ease;pointer-events:none}",
    ".hw-menu.hw-expanded .hw-subpanel{width:17rem;pointer-events:auto;",
    "border:1px solid " + PANEL_BORDER + ";border-left:none;border-radius:0 1rem 1rem 0}",
    ".hw-subset{display:none;flex-direction:column;gap:.9rem;padding:1.5rem;margin:0;list-style:none;white-space:nowrap}",
    ".hw-subset.hw-active{display:flex}",
    ".hw-sub-item{display:block;cursor:pointer}",
    "/* dark mode: match the existing .dark-glass-dropdown link treatment */",
    ".dark .hw-sub-item{color:#111d27 !important}",
    ".dark .hw-sub-item:hover{color:#825335 !important}",
    ".nav-sub-parent{position:relative}",
    ".nav-sub-link{display:flex;align-items:center;justify-content:space-between;gap:1.25rem}",
    ".nav-sub-arrow{font-size:14px;line-height:1;opacity:.55;transition:transform .2s ease,opacity .2s ease}",
    ".nav-sub-parent:hover .nav-sub-arrow{opacity:1;transform:translateX(2px)}"
  ].join("");

  var PANEL_BORDER = "rgba(0,3,8,0.1)";

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function injectStyle() {
    if (document.getElementById("nav-submenu-style")) return;
    var st = document.createElement("style");
    st.id = "nav-submenu-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function buildSubpanel(pages) {
    var subsets = pages.map(function (page) {
      var items = SUBCATS[page].map(function (sc) {
        return '<li><a class="hw-sub-item text-[13px] uppercase tracking-widest ' +
          'text-on-surface-variant dark:text-white/70 hover:text-secondary transition-colors" ' +
          'href="' + page + "?sub=" + sc.slug + '">' + esc(sc.name) + "</a></li>";
      }).join("");
      return '<ul class="hw-subset" data-for="' + page + '">' + items + "</ul>";
    }).join("");
    return '<div class="hw-subpanel">' + subsets + "</div>";
  }

  /* Scroll safety: only when a dropdown is genuinely taller than the viewport
     do we make THAT menu scroll internally. The Houseware menu is skipped —
     it hosts the expanding subpanel and never grows tall (3 categories). */
  function applyScrollSafety(menu) {
    if (menu.classList.contains("hw-menu")) return;
    var budget = Math.max(240, window.innerHeight - 120);
    if (menu.scrollHeight > budget) {
      menu.style.maxHeight = budget + "px";
      menu.style.overflowY = "auto";
    } else {
      menu.style.maxHeight = "";
      menu.style.overflowY = "";
    }
  }

  function pageFromHref(href) {
    return (href || "").split("?")[0].split("/").pop();
  }

  function enhanceDeptMenu(menu) {
    if (menu.getAttribute("data-submenu-enhanced") === "1") return;
    var touched = false;
    var links = menu.querySelectorAll(":scope > ul > li > a");
    var subsets = {};
    var pages = [];
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var page = pageFromHref(link.getAttribute("href"));
      if (!SUBCATS[page]) continue;
      pages.push(page);
      var li = link.parentElement;
      li.classList.add("nav-sub-parent");
      link.classList.add("nav-sub-link");
      if (!link.querySelector(".nav-sub-arrow")) {
        link.insertAdjacentHTML("beforeend", '<span class="nav-sub-arrow" aria-hidden="true">&#8250;</span>');
      }
      touched = true;
    }
    if (!touched) return;
    menu.classList.add("hw-menu");
    menu.insertAdjacentHTML("beforeend", buildSubpanel(pages));
    menu.querySelectorAll(".hw-subset").forEach(function (ul) { subsets[ul.getAttribute("data-for")] = ul; });

    // Minimal JS: switch the visible subset when a category is hovered.
    // The panel itself is shown/hidden by the .hw-expanded class; hiding it
    // again on full mouse leave keeps the existing dropdown close behavior.
    function activate(page) {
      menu.classList.add("hw-expanded");
      Object.keys(subsets).forEach(function (k) {
        subsets[k].classList.toggle("hw-active", k === page);
      });
    }
    function deactivate() {
      menu.classList.remove("hw-expanded");
      Object.keys(subsets).forEach(function (k) { subsets[k].classList.remove("hw-active"); });
    }
    for (var j = 0; j < links.length; j++) {
      (function (link) {
        var page = pageFromHref(link.getAttribute("href"));
        if (!SUBCATS[page]) return;
        link.parentElement.addEventListener("mouseenter", function () { activate(page); });
      })(links[j]);
    }
    menu.addEventListener("mouseleave", deactivate);
    menu.setAttribute("data-submenu-enhanced", "1");
  }

  function enhance() {
    if (window.__nassimSubmenuDone) return;
    window.__nassimSubmenuDone = true;
    injectStyle();
    var menus = document.querySelectorAll(".dropdown-trigger > .dropdown-menu");
    for (var i = 0; i < menus.length; i++) {
      // Departments with existing subcategories get the expanding panel;
      // categories without any (e.g. Checkout Solutions) stay untouched.
      enhanceDeptMenu(menus[i]);
      applyScrollSafety(menus[i]);
    }
  }

  /* Deep-link support: subcategory links point at the existing category page
     with ?sub=<slug>. The category pages initialize their own filter from
     that parameter, so the grid's FIRST render is already filtered (no "All"
     flash) and the matching chip arrives ticked. For pages that lack that
     native pre-apply, the fallback below clicks the page's OWN existing
     filter button with the matching slug (same slugify scheme). No new
     routes are invented. The pages re-clone their sidebar chips after the
     product catalog loads, which resets the tick to the first chip — so we
     keep the tick in sync with the deep-linked filter until the user chooses
     a filter themselves. */
  function slugify(s) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function btnLabel(btn) {
    return btn.textContent.replace(/check$/, "").replace(/\u203a/g, "").trim();
  }
  function applyDeepLink() {
    var slug;
    try { slug = new URLSearchParams(location.search).get("sub"); } catch (e) { return; }
    if (!slug) return;

    function findTargetName() {
      var btns = document.querySelectorAll(".subcat-tabs .category-btn, .category-btn");
      for (var i = 0; i < btns.length; i++) {
        var text = btnLabel(btns[i]);
        if (!text || /^all/i.test(text)) continue;
        if (slugify(text) === slug) return text;
      }
      return null;
    }
    function syncTicks(targetName) {
      var chips = document.querySelectorAll(".subcat-cat-chip");
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.toggle("is-active", btnLabel(chips[i]) === targetName);
      }
    }

    // Click the matching existing filter button once the page has wired them.
    // SKIPPED when the page pre-applied ?sub= at render time (the category
    // pages initialize activeSubcategory from the URL, so the very FIRST
    // render is already filtered — re-clicking would only re-render the same
    // list). The click stays as a fallback for pages without that pre-apply.
    setTimeout(function () {
      if (window.__nassimSubcatSlug) return; // page already rendered filtered
      var btns = document.querySelectorAll(".subcat-tabs .category-btn, .subcat-cat-chip, .category-btn");
      for (var i = 0; i < btns.length; i++) {
        var text = btnLabel(btns[i]);
        if (!text || /^all/i.test(text)) continue;
        if (slugify(text) === slug) { btns[i].click(); break; }
      }
    }, 800);

    // Keep the visible tick on the deep-linked subcategory while the page
    // renders/re-clones its filter chips. Disarmed as soon as the user
    // clicks any filter button themselves.
    var armed = true;
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest &&
          e.target.closest(".category-btn, .subcat-cat-chip, .filter-checkbox, .filter-radio")) {
        armed = false;
      }
    }, true);
    var deadline = Date.now() + 20000;
    var timer = setInterval(function () {
      if (!armed || Date.now() > deadline) { clearInterval(timer); return; }
      var targetName = findTargetName();
      if (targetName) syncTicks(targetName);
    }, 300);
  }

  function boot() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", enhance);
    } else {
      enhance();
    }
    applyDeepLink();
  }

  boot();
})();
