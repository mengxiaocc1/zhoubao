/* 准讯周报 · 2026 W45 精编版 · 交互脚本（无依赖） */
(function () {
  'use strict';
  var D = window.ZX, S = D.STORIES, $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式下忽略 */ } }
  };
  var READ_KEY = D.ISSUE.key + '-read';
  var read = {};
  try { read = JSON.parse(store.get(READ_KEY, '{}')) || {}; } catch (e) { read = {}; }

  var state = { sec: 'all', q: '', conf: 'all', homeY: 0, cur: null };
  var secName = {};
  D.SECTIONS.forEach(function (s) { secName[s.id] = s.name; });
  var idx = {};
  S.forEach(function (s, i) { idx[s.id] = i; });

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  /* 把 {{术语}} / {{显示|术语}} 变成可点击的名词解释 */
  function rich(s) {
    return esc(s).replace(/\{\{(.+?)\}\}/g, function (_, m) {
      var p = m.split('|'), show = p[0], key = p[1] || p[0];
      if (!D.GLOSSARY[key]) return show;
      return '<button type="button" class="term" data-k="' + key + '">' + show + '</button>';
    });
  }
  function plain(s) { return String(s).replace(/\{\{(.+?)\}\}/g, function (_, m) { return m.split('|')[0]; }); }
  function confHtml(c) {
    var o = D.CONF[c], dots = '';
    for (var i = 1; i <= 4; i++) dots += '<i class="' + (i <= o.n ? 'on' : '') + '"></i>';
    return '<span class="conf" title="' + o.hint + '"><span class="dots" aria-hidden="true">' + dots + '</span>把握 ' + o.name + '</span>';
  }
  function toast(t) {
    var el = $('toast'); el.textContent = t; el.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('on'); }, 1800);
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function storyText(s) {
    return [s.title, s.dek, s.core, s.tag, secName[s.sec], s.facts.join(' '), s.counter,
      s.why.map(function (w) { return w.h + w.p; }).join(' '),
      s.forecasts.map(function (f) { return f.t; }).join(' '),
      s.nums.map(function (n) { return n.v + n.l; }).join(' ')].join(' ').toLowerCase();
  }
  S.forEach(function (s) { s._text = plain(storyText(s)); });

  /* ---------- 首页：静态部分 ---------- */
  function renderStatic() {
    var I = D.ISSUE, L = D.LEAD;
    $('brandMeta').textContent = I.week;
    $('mastMeta').innerHTML = '<b>' + I.week + '</b><span>覆盖 ' + I.range + '</span><span>' + I.published + ' 出版</span><span>12 条新闻 · ' +
      S.reduce(function (n, s) { return n + s.forecasts.length; }, 0) + ' 条预测</span>';
    $('footMeta').textContent = I.name + ' ' + I.en + ' · ' + I.week + ' · 覆盖 ' + I.range + ' · ' + I.published + ' 出版';

    $('lead').innerHTML =
      '<div><div class="kicker">' + L.kicker + '</div><h2>' + L.title + '</h2>' +
      L.paras.map(function (p) { return '<p>' + rich(p) + '</p>'; }).join('') +
      '<p class="you">' + rich(L.you) + '</p></div>' +
      '<div class="theses">' + L.theses.map(function (t) {
        return '<button type="button" class="thesis" data-go="' + t.go[0] + '"><span class="k">' + t.k + '</span><span><h3>' + t.t +
          '</h3><p>' + t.d + '</p><div class="go">相关：' + t.go.map(function (g) { return '第 ' + (idx[g] + 1) + ' 条'; }).join('、') + ' →</div></span></button>';
      }).join('') + '</div>';

    $('nums').innerHTML = D.KEYNUMS.map(function (n) {
      return '<button type="button" class="num" data-go="' + n.go + '"><div class="v">' + n.v + '</div><div class="l">' + n.l + '</div><div class="s">' + n.s + ' →</div></button>';
    }).join('');

    $('cal').innerHTML = D.CALENDAR.map(function (c) {
      return '<button type="button" data-go="' + c.go + '"><div class="d">' + c.d + '</div><div class="t">' + c.t + '</div><div class="n">' + c.n + '</div></button>';
    }).join('');

    $('models').innerHTML = '<thead><tr><th>模型</th><th>机构</th><th>价格</th><th>看点</th><th>适合谁</th><th>出处</th></tr></thead><tbody>' +
      D.MODELS.map(function (m) {
        return '<tr><td>' + m.n + '</td><td>' + m.o + '</td><td>' + m.p + '</td><td>' + m.w + '</td><td>' + m.f +
          '</td><td><a href="' + m.u + '" target="_blank" rel="noopener noreferrer">官方 ↗</a></td></tr>';
      }).join('') + '</tbody>';

    $('gloss').innerHTML = Object.keys(D.GLOSSARY).map(function (k) {
      return '<div id="g-' + encodeURIComponent(k) + '"><b>' + k + '</b>' + D.GLOSSARY[k] + '</div>';
    }).join('');

    $('fix').innerHTML = D.CORRECTIONS.map(function (c) { return '<div><b>' + c.t + '：</b>' + c.d + '</div>'; }).join('');

    $('legend').innerHTML = ['H', 'MH', 'M', 'ML'].map(function (c) { return '<span>' + confHtml(c) + '　' + D.CONF[c].hint + '</span>'; }).join('');
    renderChips(); renderLedgerChips(); renderGrid(); renderLedger();
  }

  function renderChips() {
    var counts = { all: S.length };
    S.forEach(function (s) { counts[s.sec] = (counts[s.sec] || 0) + 1; });
    var h = '<button type="button" class="chip" data-sec="all" aria-pressed="' + (state.sec === 'all') + '">全部<i>' + counts.all + '</i></button>';
    D.SECTIONS.forEach(function (s) {
      h += '<button type="button" class="chip" data-sec="' + s.id + '" aria-pressed="' + (state.sec === s.id) + '" title="' + s.desc + '">' + s.name + '<i>' + counts[s.id] + '</i></button>';
    });
    h += '<span class="chip-sep"></span>' +
      [['b-cal', '日历'], ['b-ledger', '预测台账'], ['b-models', '模型速查'], ['b-gloss', '名词解释']].map(function (a) {
        return '<button type="button" class="chip link" data-jump="' + a[0] + '">' + a[1] + '</button>';
      }).join('');
    $('chips').innerHTML = h;
  }

  function matches(s) {
    if (state.sec !== 'all' && s.sec !== state.sec) return false;
    if (!state.q) return true;
    return state.q.toLowerCase().split(/\s+/).every(function (w) { return s._text.indexOf(w) >= 0; });
  }

  function renderGrid() {
    var list = S.filter(matches), featured = state.sec === 'all' && !state.q;
    var h = list.map(function (s, k) {
      var big = featured && k === 0, n = idx[s.id] + 1;
      return '<a class="card' + (big ? ' big' : '') + (read[s.id] ? ' read' : '') + '" href="#/s/' + s.id + '">' +
        '<div class="m"><span class="no">' + (n < 10 ? '0' + n : n) + '</span><b>' + s.tag + '</b><span>' + s.date + '</span>' +
        (read[s.id] ? '<span class="rd">✓ 已读</span>' : '') + '</div>' +
        '<h3>' + s.title + '</h3><p class="dek">' + plain(s.dek) + '</p>' +
        '<div class="verdict"><b>一句话判断</b>' + plain(s.core) + '</div>' +
        '<div class="ft"><span class="pill">' + secName[s.sec] + '</span><span>' + s.forecasts.length + ' 条预测</span><span class="more">读点评 →</span></div></a>';
    }).join('');
    if (!list.length) h = '<div class="empty">没有找到与「' + esc(state.q) + '」相关的内容。<button type="button" id="clearQ">清除筛选</button></div>';
    $('grid').innerHTML = h;
    var done = S.filter(function (s) { return read[s.id]; }).length;
    $('readStat').textContent = (state.q || state.sec !== 'all' ? '显示 ' + list.length + ' / ' + S.length + ' 条 · ' : '') + '已读 ' + done + ' / ' + S.length;
  }

  function renderLedgerChips() {
    var h = '<button type="button" class="chip" data-conf="all" aria-pressed="' + (state.conf === 'all') + '">全部</button>';
    ['H', 'MH', 'M', 'ML'].forEach(function (c) {
      h += '<button type="button" class="chip" data-conf="' + c + '" aria-pressed="' + (state.conf === c) + '">把握 ' + D.CONF[c].name + '</button>';
    });
    $('ledgerChips').innerHTML = h;
  }
  function renderLedger() {
    var rows = [], n = 0, total = 0;
    S.forEach(function (s) {
      s.forecasts.forEach(function (f) {
        total++;
        if (state.conf !== 'all' && f.c !== state.conf) return;
        n++;
        rows.push('<div class="lrow"><span class="i">' + (n < 10 ? '0' + n : n) + '</span><div class="tx">' + rich(f.t) +
          '<button type="button" data-go="' + s.id + '">出自第 ' + (idx[s.id] + 1) + ' 条：' + s.tag + ' →</button></div>' +
          '<div class="by">' + f.by + '</div><div class="cf">' + confHtml(f.c) + '</div></div>');
      });
    });
    $('ledger').innerHTML = rows.join('');
    $('ledgerStat').textContent = '共 ' + total + ' 条' + (state.conf !== 'all' ? ' · 当前显示 ' + n + ' 条' : '');
  }

  /* ---------- 文章页 ---------- */
  function chartHtml(c) {
    return '<figure class="chart"><h3>' + c.title + '</h3>' + c.rows.map(function (r) {
      var w = Math.max(1.5, Math.min(100, r.v / c.max * 100));
      return '<div class="crow' + (r.hi ? ' hi' : '') + (r.neg ? ' neg' : '') + '" title="' + r.l + '：' + r.t + '">' +
        '<div class="cl">' + r.l + '</div><div class="cb"><span class="bar" data-w="' + w.toFixed(1) + '" style="width:0"></span><span class="cv">' + r.t + '</span></div></div>';
    }).join('') + '<figcaption class="cn">' + c.note + '</figcaption></figure>';
  }

  function renderArticle(s) {
    var i = idx[s.id], prev = S[i - 1], next = S[i + 1];
    var h = '<div class="abar"><button type="button" class="back" data-home>← 返回目录</button>' +
      '<span class="pos">第 ' + (i + 1) + ' / ' + S.length + ' 条</span>' +
      '<button type="button" class="ibtn pn" data-go="' + (prev ? prev.id : '') + '"' + (prev ? '' : ' disabled') + '>← 上一条</button>' +
      '<button type="button" class="ibtn pn" data-go="' + (next ? next.id : '') + '"' + (next ? '' : ' disabled') + '>下一条 →</button></div>';

    h += '<header class="ahead fade"><div class="m"><b>' + s.tag + '</b><span>' + secName[s.sec] + '</span><span>' + s.date + '</span></div>' +
      '<h1>' + s.title + '</h1><p class="dek">' + rich(s.dek) + '</p></header>';
    h += '<div class="astats">' + s.nums.map(function (n) { return '<div><div class="v">' + n.v + '</div><div class="l">' + n.l + '</div></div>'; }).join('') + '</div>';
    h += '<div class="verdict-xl fade"><b>一句话判断</b><p>' + rich(s.core) + '</p></div>';

    h += '<div class="acols"><div class="amain">';
    h += '<section><div class="sh"><span>一</span><h2>发生了什么</h2><small>已核对的事实</small></div><ul class="facts">' +
      s.facts.map(function (f) { return '<li>' + rich(f) + '</li>'; }).join('') + '</ul>' + (s.chart ? chartHtml(s.chart) : '') + '</section>';
    h += '<section><div class="sh"><span>二</span><h2>为什么重要</h2><small>准讯点评</small></div><ol class="why">' +
      s.why.map(function (w) { return '<li><h3>' + w.h + '</h3><p>' + rich(w.p) + '</p></li>'; }).join('') + '</ol></section>';
    h += '<section><div class="sh"><span>三</span><h2>另一种看法</h2><small>反方与存疑</small></div><div class="counter"><b>我们可能错在哪</b><p>' + rich(s.counter) + '</p></div>' +
      (s.note ? '<p class="note">' + s.note + '</p>' : '') + '</section>';
    h += '</div><aside class="aside">';
    h += '<div class="panel fcp"><h2>接下来会怎样</h2><div class="ph">每条预测都写明期限和把握，到期对账。</div>' +
      s.forecasts.map(function (f) {
        return '<div class="fc"><p>' + rich(f.t) + '</p><div class="fm"><span>期限：' + f.by + '</span>' + confHtml(f.c) + '</div>' +
          (f.x ? '<div class="fx"><b>如何判断我们错了：</b>' + f.x + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    h += '<div class="panel"><h2>对你意味着什么</h2><ul class="you">' +
      s.you.map(function (y) { return '<li><b>' + y.who + '</b>' + rich(y.d) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="panel"><h2>信源</h2><div class="srcs">' +
      s.src.map(function (x) { return '<a href="' + x[1] + '" target="_blank" rel="noopener noreferrer">' + x[0] + '</a>'; }).join('') + '</div></div>';
    h += '<div class="acts"><button type="button" class="ibtn" data-copy="sum">复制摘要</button><button type="button" class="ibtn" data-copy="link">复制链接</button></div>';
    h += '</aside></div>';

    h += '<div class="anext">' +
      (prev ? '<button type="button" data-go="' + prev.id + '"><small>← 上一条</small><b>' + prev.title + '</b></button>' : '<span></span>') +
      (next ? '<button type="button" class="nx" data-go="' + next.id + '"><small>下一条 →</small><b>' + next.title + '</b></button>'
        : '<button type="button" class="nx" data-home data-jump="b-ledger"><small>读完了 →</small><b>去看预测台账</b></button>') + '</div>';
    h += '<footer><div>' + D.ISSUE.name + ' · ' + D.ISSUE.week + '</div><div>本刊点评与预测为编辑部观点，不构成投资建议。</div></footer>';

    $('articleBody').innerHTML = h;
    $('dkPrev').disabled = !prev; $('dkNext').disabled = !next;
    document.title = s.title + ' · 准讯周报';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        [].forEach.call(document.querySelectorAll('#articleBody .bar'), function (b) { b.style.width = 'calc(' + b.dataset.w + '% - 70px)'; });
      });
    });
    if (!read[s.id]) { read[s.id] = 1; store.set(READ_KEY, JSON.stringify(read)); }
  }

  /* ---------- 路由 ---------- */
  function route() {
    hidePop();
    var m = location.hash.match(/^#\/s\/([\w-]+)/), s = m && S[idx[m[1]]];
    if (s) {
      if (!state.cur) state.homeY = window.scrollY;
      state.cur = s.id;
      $('home').hidden = true; $('article').hidden = false; $('dock').hidden = false; $('chips').hidden = true;
      renderArticle(s);
      window.scrollTo(0, 0);
    } else {
      var was = state.cur; state.cur = null;
      $('article').hidden = true; $('dock').hidden = true; $('home').hidden = false; $('chips').hidden = false;
      document.title = '准讯周报 · ' + D.ISSUE.week + '（' + D.ISSUE.range + '）';
      renderGrid();
      var j = state.jump; state.jump = null;
      if (j) jump(j); else if (was) window.scrollTo(0, state.homeY);
    }
    onScroll();
  }
  function jump(id) {
    var el = $(id); if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 104, behavior: 'smooth' });
  }

  /* ---------- 名词解释浮层 ---------- */
  var pop = $('pop'), popFor = null;
  function showPop(btn) {
    var k = btn.dataset.k; popFor = btn;
    pop.innerHTML = '<b>' + k + '</b>' + D.GLOSSARY[k];
    pop.hidden = false;
    var r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    var x = Math.max(10, Math.min(window.innerWidth - pw - 10, r.left + r.width / 2 - pw / 2));
    var y = r.top - ph - 8 < 70 ? r.bottom + 8 : r.top - ph - 8;
    pop.style.left = (x + window.scrollX) + 'px'; pop.style.top = (y + window.scrollY) + 'px';
  }
  function hidePop() { pop.hidden = true; popFor = null; }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a');
    if (!e.target.closest('.term')) hidePop();
    if (!t) return;
    if (t.classList.contains('term')) { if (popFor === t) hidePop(); else showPop(t); return; }
    if (t.id === 'clearQ') { state.q = ''; state.sec = 'all'; $('q').value = ''; renderChips(); renderGrid(); return; }
    if (t.dataset.sec) {
      state.sec = t.dataset.sec; renderChips(); renderGrid();
      if (window.scrollY > $('b-stories').offsetTop) jump('b-stories');
      return;
    }
    if (t.dataset.conf) { state.conf = t.dataset.conf; renderLedgerChips(); renderLedger(); return; }
    if (t.hasAttribute('data-home')) { state.jump = t.dataset.jump || null; go('#/'); return; }
    if (t.dataset.jump) { jump(t.dataset.jump); return; }
    if (t.dataset.go) { go('#/s/' + t.dataset.go); return; }
    if (t.dataset.copy) {
      var s = S[idx[state.cur]], url = location.href, txt = url;
      if (t.dataset.copy === 'sum') {
        txt = '【' + s.title + '】\n' + plain(s.dek) + '\n\n判断：' + plain(s.core) + '\n\n预测：\n' +
          s.forecasts.map(function (f, i) { return (i + 1) + '. ' + plain(f.t) + '（' + f.by + '，把握' + D.CONF[f.c].name + '）'; }).join('\n') +
          '\n\n—— 准讯周报 ' + D.ISSUE.week + ' ' + url;
      }
      copy(txt, t.dataset.copy === 'sum' ? '摘要已复制' : '链接已复制');
    }
  });
  function copy(txt, ok) {
    function fb() {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(ok); } catch (e) { toast('复制失败，请手动复制'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(function () { toast(ok); }, fb); else fb();
  }
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest && e.target.closest('.term');
    if (t && matchMedia('(hover:hover)').matches) showPop(t);
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest && e.target.closest('.term') && matchMedia('(hover:hover)').matches) hidePop();
  });

  var qT;
  $('q').addEventListener('input', function () {
    var v = this.value.trim();
    clearTimeout(qT);
    qT = setTimeout(function () {
      state.q = v;
      if (state.cur) { state.jump = 'b-stories'; go('#/'); } else { renderGrid(); if (v) jump('b-stories'); }
    }, 140);
  });

  function setTheme(t) {
    root.dataset.theme = t; store.set('zx-theme', t);
    $('themeTx').textContent = t === 'dark' ? '日间' : '夜间';
    var mc = document.querySelector('meta[name=theme-color]'); if (mc) mc.content = t === 'dark' ? '#121211' : '#F7F4EE';
  }
  $('themeBtn').addEventListener('click', function () { setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'); });
  $('fsBtn').addEventListener('click', function () {
    var o = ['', 'l', 'xl'], n = o[(o.indexOf(root.dataset.fs || '') + 1) % 3];
    if (n) root.dataset.fs = n; else delete root.dataset.fs;
    store.set('zx-fs', n); toast(['标准字号', '大字号', '特大字号'][o.indexOf(n)]);
  });

  function step(d) {
    if (!state.cur) return;
    var n = S[idx[state.cur] + d]; if (n) go('#/s/' + n.id);
  }
  $('dkPrev').addEventListener('click', function () { step(-1); });
  $('dkNext').addEventListener('click', function () { step(1); });
  $('dkHome').addEventListener('click', function () { go('#/'); });

  document.addEventListener('keydown', function (e) {
    var inField = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (!pop.hidden) { hidePop(); return; }
      if (inField) { document.activeElement.blur(); return; }
      if (state.cur) go('#/');
      return;
    }
    if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); $('q').focus(); $('q').select(); }
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 't' || e.key === 'T') $('themeBtn').click();
  });

  /* 手机上左右滑动切换文章 */
  var tx = 0, ty = 0;
  $('article').addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  $('article').addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 90 && Math.abs(dy) < 40 && !e.target.closest('.tbl')) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  function onScroll() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    $('progress').style.width = (state.cur && h > 0 ? Math.min(100, window.scrollY / h * 100) : 0) + '%';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', hidePop);

  renderStatic();
  setTheme(root.dataset.theme || 'light');
  route();
})();
