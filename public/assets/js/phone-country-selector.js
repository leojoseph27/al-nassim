/* ===== Phone country-code selector (checkout phone field) ==================
   ONE shared country dataset (ISO2 : dialing code : English name), authored
   alphabetically. ISRAEL IS EXCLUDED BY OMISSION — it cannot appear in the
   list or in search results.

   Enhances a phone field made of:
     <button id="cc-selector">🇰🇼 <span id="cc-code">+965</span> ▼</button>
     <input id="cust-phone" data-dial="965">
   The selector only updates the visible flag/code and the input's data-dial
   attribute; the page's checkout script reads that attribute when it builds
   the submitted customerPhone value. ======================================= */
(function () {
  "use strict";

  var RAW = "AF:93:Afghanistan,AL:355:Albania,DZ:213:Algeria,AD:376:Andorra,AO:244:Angola,AR:54:Argentina,AM:374:Armenia,AU:61:Australia,AT:43:Austria,AZ:994:Azerbaijan,BS:1-242:Bahamas,BH:973:Bahrain,BD:880:Bangladesh,BB:1-246:Barbados,BY:375:Belarus,BE:32:Belgium,BZ:501:Belize,BJ:229:Benin,BT:975:Bhutan,BO:591:Bolivia,BA:387:Bosnia and Herzegovina,BW:267:Botswana,BR:55:Brazil,BN:673:Brunei,BG:359:Bulgaria,BF:226:Burkina Faso,BI:257:Burundi,KH:855:Cambodia,CM:237:Cameroon,CA:1:Canada,CV:238:Cape Verde,CF:236:Central African Republic,TD:235:Chad,CL:56:Chile,CN:86:China,CO:57:Colombia,KM:269:Comoros,CG:242:Congo,CR:506:Costa Rica,HR:385:Croatia,CU:53:Cuba,CY:357:Cyprus,CZ:420:Czech Republic,DK:45:Denmark,DJ:253:Djibouti,DM:1-767:Dominica,DO:1-809:Dominican Republic,EC:593:Ecuador,EG:20:Egypt,SV:503:El Salvador,GQ:240:Equatorial Guinea,ER:291:Eritrea,EE:372:Estonia,ET:251:Ethiopia,FJ:679:Fiji,FI:358:Finland,FR:33:France,GA:241:Gabon,GM:220:Gambia,GE:995:Georgia,DE:49:Germany,GH:233:Ghana,GR:30:Greece,GL:299:Greenland,GD:1-473:Grenada,GT:502:Guatemala,GN:224:Guinea,GW:245:Guinea-Bissau,GY:592:Guyana,HT:509:Haiti,HN:504:Honduras,HK:852:Hong Kong,HU:36:Hungary,IS:354:Iceland,IN:91:India,ID:62:Indonesia,IR:98:Iran,IQ:964:Iraq,IE:353:Ireland,IT:39:Italy,CI:225:Ivory Coast,JM:1-876:Jamaica,JP:81:Japan,JO:962:Jordan,KZ:7:Kazakhstan,KE:254:Kenya,KI:686:Kiribati,KW:965:Kuwait,KG:996:Kyrgyzstan,LA:856:Laos,LV:371:Latvia,LB:961:Lebanon,LS:266:Lesotho,LR:231:Liberia,LY:218:Libya,LI:423:Liechtenstein,LT:370:Lithuania,LU:352:Luxembourg,MO:853:Macau,MG:261:Madagascar,MW:265:Malawi,MY:60:Malaysia,MV:960:Maldives,ML:223:Mali,MT:356:Malta,MH:692:Marshall Islands,MR:222:Mauritania,MU:230:Mauritius,MX:52:Mexico,FM:691:Micronesia,MD:373:Moldova,MC:377:Monaco,MN:976:Mongolia,ME:382:Montenegro,MA:212:Morocco,MZ:258:Mozambique,MM:95:Myanmar,NA:264:Namibia,NR:674:Nauru,NP:977:Nepal,NL:31:Netherlands,NZ:64:New Zealand,NI:505:Nicaragua,NE:227:Niger,NG:234:Nigeria,KP:850:North Korea,MK:389:North Macedonia,NO:47:Norway,OM:968:Oman,PK:92:Pakistan,PW:680:Palau,PS:970:Palestine,PA:507:Panama,PG:675:Papua New Guinea,PY:595:Paraguay,PE:51:Peru,PH:63:Philippines,PL:48:Poland,PT:351:Portugal,QA:974:Qatar,RO:40:Romania,RU:7:Russia,RW:250:Rwanda,KN:1-869:Saint Kitts and Nevis,LC:1-758:Saint Lucia,VC:1-784:Saint Vincent,WS:685:Samoa,SM:378:San Marino,ST:239:Sao Tome and Principe,SA:966:Saudi Arabia,SN:221:Senegal,RS:381:Serbia,SC:248:Seychelles,SL:232:Sierra Leone,SG:65:Singapore,SK:421:Slovakia,SI:386:Slovenia,SB:677:Solomon Islands,SO:252:Somalia,ZA:27:South Africa,KR:82:South Korea,SS:211:South Sudan,ES:34:Spain,LK:94:Sri Lanka,SD:249:Sudan,SR:597:Suriname,SZ:268:Eswatini,SE:46:Sweden,CH:41:Switzerland,SY:963:Syria,TW:886:Taiwan,TJ:992:Tajikistan,TZ:255:Tanzania,TH:66:Thailand,TL:670:Timor-Leste,TG:228:Togo,TO:676:Tonga,TT:1-868:Trinidad and Tobago,TN:216:Tunisia,TR:90:Turkey,TM:993:Turkmenistan,TV:688:Tuvalu,UG:256:Uganda,UA:380:Ukraine,AE:971:United Arab Emirates,GB:44:United Kingdom,US:1:United States,UY:598:Uruguay,UZ:998:Uzbekistan,VU:678:Vanuatu,VA:379:Vatican City,VE:58:Venezuela,VN:84:Vietnam,YE:967:Yemen,ZM:260:Zambia,ZW:263:Zimbabwe";

  var COUNTRIES = RAW.split(',').map(function (s) {
    var p = s.split(':');
    return { iso: p[0], dial: p[1], name: p[2] };
  }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });

  function flag(iso) {
    return String.fromCodePoint.apply(null, [].map.call(iso, function (c) { return 127397 + c.charCodeAt(0); }));
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var btn = document.getElementById('cc-selector');
    var input = document.getElementById('cust-phone');
    if (!btn || !input) return;

    var wrap = btn.parentElement;              /* the unified rounded container */
    var dd = document.createElement('div');
    dd.id = 'cc-dropdown';
    dd.className = 'hidden absolute z-[70] left-2 right-2 mt-2 bg-white dark:bg-[#141a22] border border-black/10 dark:border-white/15 rounded-xl shadow-2xl overflow-hidden';
    dd.style.top = '100%';
    dd.innerHTML =
      '<div class="p-2 border-b border-black/10 dark:border-white/15">' +
        '<input id="cc-search" type="text" placeholder="Search country..." autocomplete="off"' +
        ' class="w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/15 bg-transparent text-on-surface dark:text-white placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-1 focus:ring-secondary"/>' +
      '</div>' +
      '<div id="cc-list" role="listbox" style="max-height:260px;overflow-y:auto;"></div>';
    wrap.appendChild(dd);

    var list = dd.querySelector('#cc-list');
    var search = dd.querySelector('#cc-search');

    function render(q) {
      q = (q || '').trim().toLowerCase();
      list.innerHTML = '';
      var shown = 0;
      COUNTRIES.forEach(function (c) {
        if (q && c.name.toLowerCase().indexOf(q) === -1) return;
        shown++;
        var row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('role', 'option');
        row.className = 'cc-row w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors' +
          (c.dial === (input.dataset.dial || '965') ? ' cc-selected' : '');
        row.innerHTML = '<span aria-hidden="true">' + flag(c.iso) + '</span>' +
          '<span class="flex-1 truncate">' + c.name + '</span>' +
          '<span class="text-on-surface-variant dark:text-white/60">+' + c.dial + '</span>';
        row.addEventListener('click', function () {
          input.dataset.dial = c.dial;
          input.dataset.iso = c.iso;
          input.dataset.cname = c.name;
          input.maxLength = c.dial === '965' ? 8 : 12;
          document.getElementById('cc-flag').textContent = flag(c.iso);
          document.getElementById('cc-code').textContent = '+' + c.dial;
          close();
          input.focus();
        });
        list.appendChild(row);
      });
      if (!shown) {
        var empty = document.createElement('div');
        empty.className = 'cc-empty px-3 py-4 text-sm text-center';
        empty.textContent = 'No matching country';
        list.appendChild(empty);
      }
    }

    function openDd() {
      dd.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      var ch = document.getElementById('cc-chevron');
      if (ch) ch.style.transform = 'rotate(180deg)';
      search.value = '';
      render('');
      setTimeout(function () { search.focus(); }, 0);
    }
    function close() {
      dd.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      var ch = document.getElementById('cc-chevron');
      if (ch) ch.style.transform = '';
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      dd.classList.contains('hidden') ? openDd() : close();
    });
    search.addEventListener('input', function () { render(search.value); });
    search.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function (e) {
      if (!dd.classList.contains('hidden') && !wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dd.classList.contains('hidden')) { close(); btn.focus(); }
    });
  });
})();
