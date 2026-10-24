/**
 * AL-NASSIM Progressive Product Grid (shared)
 * ============================================================================
 * Category/listing pages keep their own filter/sort logic and their own card
 * HTML builder, but instead of building every card in one innerHTML call they
 * hand the filtered list to NassimProgressive.render():
 *
 *   - The first batch (INITIAL) renders immediately with eager images so the
 *     top of the grid paints as soon as the catalogue is available.
 *   - A 1px sentinel at the end of the grid is observed with an
 *     IntersectionObserver (600px pre-render margin). Whenever it approaches
 *     the viewport, the next batch (BATCH) of cards is appended. Batches are
 *     sliced synchronously from the already-fetched catalogue, so there is no
 *     network wait, no artificial delay, and no rAF dependency (rAF throttles
 *     in background tabs and would stall the fill).
 *   - Cards beyond the first batch get loading="lazy" decoding="async" on
 *     their <img>, so off-screen and pagination-hidden products never fetch
 *     or decode their images until they are actually shown. Because a batch
 *     append is a single synchronous insert, no skeleton state is ever visible
 *     — there is no pending period between "prepared" and "shown".
 *   - Card wrappers already reserve their aspect ratio, so batched appends
 *     cause no layout shift.
 *   - render() fully resets on every call (filters/sort/search re-render the
 *     list from scratch, so no duplicates are possible), and the observer is
 *     disconnected once the list is exhausted or on the next render.
 *
 * listing-pagination.js keeps working: it re-slices visible cards after each
 * batch (its MutationObserver fires on every append) and only restores a
 * ?page=N deep link once the grid signals renderComplete.
 */
(function () {
  "use strict";

  var INITIAL = 8;              // products rendered with the first paint
  var BATCH = 8;                // products appended per scroll batch
  var ROOT_MARGIN = "600px 0px"; // pre-render distance before the sentinel
  var state = null;

  function cleanup() {
    if (state && state.io) state.io.disconnect();
    if (state && state.sentinel && state.sentinel.parentNode) state.sentinel.parentNode.removeChild(state.sentinel);
    state = null;
  }

  function imgAttrs(i) {
    // Priority ladder: ONLY the very first product image is the LCP candidate
    // and gets fetchpriority=high. The rest of the first batch (initially
    // visible / near-viewport) load eagerly at default priority — giving
    // every image high priority would make them all compete with the LCP
    // image instead of yielding to it. Beyond the first batch: native lazy.
    if (i === 0) return '<img fetchpriority="high" decoding="async" ';
    if (i < INITIAL) return '<img decoding="async" ';
    return '<img loading="lazy" decoding="async" ';
  }

  function buildCard(p, i) {
    // Exactly one <img> per card template: upgrade it with native lazy-loading
    // hints without touching the page's own markup or object-fit behaviour.
    return state.cardHTML(p).replace("<img ", imgAttrs(i));
  }

  function appendBatch() {
    if (!state) return;
    var s = state;
    var next = s.list.slice(s.rendered, s.rendered + BATCH);
    if (!next.length) {
      cleanup();
      s.grid.dataset.renderComplete = "1";
      return;
    }
    var eager = s.rendered < INITIAL;
    s.sentinel.insertAdjacentHTML("beforebegin", next.map(function (p, k) { return buildCard(p, s.rendered + k); }).join(""));
    s.rendered += next.length;
    if (s.onBatch) s.onBatch();
    if (s.rendered >= s.list.length) {
      cleanup();
      s.grid.dataset.renderComplete = "1";
    }
  }

  /* Append batches until the sentinel sits beyond the pre-render margin, so
     fast scrolling never outruns the renderer. Bounded by the list length. */
  function fillUntilCovered() {
    var guard = 0;
    while (state && state.rendered < state.list.length && guard < 100) {
      var r = state.sentinel.getBoundingClientRect();
      if (r.top > window.innerHeight + 600) break;
      appendBatch();
      if (state && state.rendered >= state.list.length) break;
      guard++;
    }
  }

  function render(opts) {
    cleanup();
    if (!opts || !opts.grid || !opts.list || !opts.list.length || typeof opts.cardHTML !== "function") return;
    state = {
      grid: opts.grid,
      list: opts.list,
      countEl: opts.countEl || null,
      cardHTML: opts.cardHTML,
      onBatch: opts.onBatch || null,
      rendered: 0
    };
    delete opts.grid.dataset.renderComplete;
    opts.grid.dataset.progressiveRender = "1";
    if (state.countEl) state.countEl.textContent = "Number of items: " + state.list.length;

    // Deep link (?page=N, N>1): pagination cannot restore the requested page
    // until every card exists, and the user must not stare at page-1 content
    // while batches fill. The list is already in memory, so render it all at
    // once in this case — progressive batching only benefits the common
    // page-1 entry.
    var deepPage = 1;
    try {
      var v = parseInt(new URLSearchParams(window.location.search).get("page"), 10);
      if (v >= 2) deepPage = v;
    } catch (e) { /* older engines */ }

    var sentinel = document.createElement("div");
    sentinel.id = "nassim-grid-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "grid-column:1/-1;height:1px;";
    opts.grid.innerHTML = "";
    opts.grid.appendChild(sentinel);
    state.sentinel = sentinel;

    if (deepPage >= 2) {
      var guard = 0;
      while (state && state.rendered < state.list.length && guard < 500) {
        appendBatch();
        guard++;
      }
      return;
    }

    state.io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) fillUntilCovered();
    }, { rootMargin: ROOT_MARGIN });
    state.io.observe(sentinel);

    appendBatch(); // first batch: eager images, immediate paint
    // Cover the pre-render margin right away (tall viewports / short grids).
    fillUntilCovered();
  }

  window.NassimProgressive = { render: render, cancel: cleanup };
})();
