/* ==== Shared "Added to cart" toast — one implementation for every page ====
   Byte-for-byte the same behaviour/design as the reference implementation in
   product-view.html (do NOT change product-view.html): the #toast-container
   fixed at top-28 centered (z-100, pointer-events-none), the slideUp
   animation (0.3s), the pill styling (bg-primary/90, uppercase, rounded-full)
   and the 3000ms duration with 0.4s fade-out. Pages with their own legacy
   showToast delegate here via window.NassimShowToast. Only one toast can be
   visible at a time (the container is cleared and the timer reset each call),
   so a single click can never stack duplicate notifications.
   The tailwind utility classes used here all exist in the shared
   /assets/css/tailwind.css build. ==== */
(function () {
  var toastTimeout = null;
  var styleInjected = false;

  function ensureStyles() {
    if (styleInjected) return;
    styleInjected = true;
    var style = document.createElement("style");
    style.textContent =
      "@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }" +
      ".toast-animate { animation: slideUp 0.3s ease-out forwards; }" +
      /* Mobile only: give the pill enough width that the cart icon, text and
         check icon always sit on ONE line (flex is nowrap; this guarantees
         the room), centre the row, and keep the height unchanged. */
      "@media (max-width: 767px) { #toast-container .toast-animate { min-width: 240px; justify-content: center; } }";
    document.head.appendChild(style);
  }

  function ensureContainer() {
    var container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "fixed top-28 left-1/2 -translate-x-1/2 z-[100] pointer-events-none";
      container.id = "toast-container";
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message) {
    var container = ensureContainer();
    ensureStyles();
    while (container.firstChild) container.removeChild(container.firstChild);
    if (toastTimeout) clearTimeout(toastTimeout);
    var toast = document.createElement("div");
    toast.className = "toast-animate bg-primary/90 text-on-primary px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest shadow-2xl backdrop-blur-md border border-white/10 flex items-center gap-2 mb-4 pointer-events-auto";
    /* True pill shape: the site's compiled tailwind.css maps .rounded-full to
       0.75rem (12px), so the pill radius must be forced inline. */
    toast.style.borderRadius = "9999px";
    /* Icon row: [cart] text [check] — the SAME shopping_cart glyph the top
       navigation uses (Material Symbols), sized to match the check icon.
       In Arabic mode (html.lang-ar, the site's existing direction mechanism)
       the row flips to [check] النص [cart] purely via direction:rtl — the
       icon order reverses without touching the text itself. */
    var isAr = document.documentElement.classList.contains("lang-ar");
    if (isAr) toast.style.direction = "rtl";
    var isCartAdd = message === "Added to cart";
    var text = isCartAdd && isAr ? "تمت الإضافة إلى السلة" : message;
    var iconName = "check_circle";
    if (message.includes("Removed")) iconName = "heart_minus";
    if (message.includes("Link copied")) iconName = "content_copy";
    toast.innerHTML = isCartAdd
      ? /* [cart] text [check] — same glyph as the top-nav cart icon */
        '<span class="material-symbols-outlined text-sm">shopping_cart</span>' +
        "<span>" + text + "</span>" +
        '<span class="material-symbols-outlined text-sm">' + iconName + "</span>"
      : /* non-cart messages keep the original single-icon layout */
        '<span class="material-symbols-outlined text-sm">' + iconName + "</span>" + text;
    container.appendChild(toast);
    toastTimeout = setTimeout(function () {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-20px)";
      toast.style.transition = "all 0.4s ease";
      setTimeout(function () {
        if (toast.parentNode === container) toast.remove();
      }, 400);
    }, 3000);
  }

  window.NassimShowToast = showToast;
})();
