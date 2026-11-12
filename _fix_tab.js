const fs = require('fs');
const f = 'public/checkout5.html';
let s = fs.readFileSync(f, 'utf8');

// 1. tab centred on the screen
s = s.replace("    left: 50%;\n    top: 100%;\n    transform: translateX(-50%);\n    width: 84px;",
              "    left: 50vw;\n    top: 100%;\n    transform: translateX(-50%);\n    width: 84px;");

// 2. dividers become two dedicated spans (the ::before/::after pair stays
//    exclusive to the curved shoulders)
const oldDivider = `  /* left divider = the tab's ::after, extending from the circle to the
     screen edge; right divider = a real span inside the tab */
  .os-mbar .os-mbar-tab::after {
    content: "";
    position: absolute;
    top: 50%;
    left: -46vw;
    width: calc(50vw - 30px);
    height: 1px;
    background: #d8dce2;
    pointer-events: none;
  }
  .os-mbar .os-mbar-divider-r {
    position: absolute;
    top: 50%;
    left: calc(100% + 12px);
    width: calc(50vw - 30px);
    height: 1px;
    background: #d8dce2;
    pointer-events: none;
  }`;
if (!s.includes(oldDivider)) throw new Error('divider css anchor missing');
const newDivider = `  .os-mbar .os-mbar-divider-l,
  .os-mbar .os-mbar-divider-r {
    position: absolute;
    top: 50%;
    height: 1px;
    background: #d8dce2;
    pointer-events: none;
  }
  .os-mbar .os-mbar-divider-l {
    /* from ~6px off the left screen edge to 12px before the circle */
    left: calc(-50vw + 6px);
    width: calc(50vw - 30px);
  }
  .os-mbar .os-mbar-divider-r {
    /* from 12px after the circle to ~6px off the right screen edge */
    left: calc(100% + 12px);
    width: calc(50vw - 30px);
  }`;
s = s.replace(oldDivider, newDivider);

// 3. dark dividers rule: drop the dead ::after/divider-l selectors
s = s.replace("  html.dark .os-mbar .os-mbar-tab::after,\n  html.dark .os-mbar .os-mbar-divider-l,\n  html.dark .os-mbar .os-mbar-divider-r { background: #39414c; }}",
              "  html.dark .os-mbar .os-mbar-divider-l,\n  html.dark .os-mbar .os-mbar-divider-r { background: #39414c; }}");

// 4. markup: left divider span inside the tab
const m = '  <span class="os-mbar-tab" id="os-mbar-tab" aria-hidden="true"><span class="os-mbar-divider-r"></span><span class="material-symbols-outlined">expand_more</span></span>';
if (!s.includes(m)) throw new Error('tab markup anchor missing');
s = s.replace(m, '  <span class="os-mbar-tab" id="os-mbar-tab" aria-hidden="true"><span class="os-mbar-divider-l"></span><span class="os-mbar-divider-r"></span><span class="material-symbols-outlined">expand_more</span></span>');

fs.writeFileSync(f, s);
console.log('dividers rebuilt; tab screen-centred');
