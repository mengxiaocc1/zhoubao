/* 准讯周报 · 视频引擎（页面内）
 * 页面里的所有动画都是时间 t 的纯函数：渲染器逐帧调用 window.seek(t) 再截图，
 * 所以画面完全可复现，不依赖浏览器实时播放。
 *
 * 时间引用（data-at / data-off / data-beat）：
 *   "intro"        beat 开始        "intro$"     beat 结束
 *   "intro.2"      beat 第 2 句开始  "intro.2$"   第 2 句结束
 *   "+0.4"         相对所在场景开始  以上都可以再加 "+0.3" / "-0.2"
 */
(function () {
  'use strict';
  var TL = window.TL;
  var HOOKS = (window.HOOKS = window.HOOKS || []);

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function prog(t, a, d) { return d <= 0 ? (t >= a ? 1 : 0) : clamp((t - a) / d, 0, 1); }
  var E = {
    out: function (p) { return 1 - Math.pow(1 - p, 3); },
    inout: function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
    back: function (p) { var c = 1.4; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    lin: function (p) { return p; }
  };
  window.ZXV = { clamp: clamp, prog: prog, E: E, ref: ref };

  function ref(s, base) {
    if (s == null || s === '') return base;
    s = String(s).trim();
    var m = s.match(/^([A-Za-z0-9_]*)(?:\.(\d+))?(\$)?((?:[+-][\d.]+)*)$/);
    if (!m) throw new Error('bad time ref: ' + s);
    var t = base;
    if (m[1]) {
      var b = TL.beats[m[1]];
      if (!b) throw new Error('unknown beat: ' + m[1]);
      if (m[2]) { var ln = b.lines[+m[2] - 1]; if (!ln) throw new Error('no line ' + s); t = m[3] ? ln.end : ln.start; }
      else t = m[3] ? b.end : b.start;
    }
    (m[4].match(/[+-][\d.]+/g) || []).forEach(function (o) { t += parseFloat(o); });
    return t;
  }

  var scenes = [], items = [], cap, capText, progEl;

  function init() {
    var lead = parseFloat(document.body.dataset.lead || '0.25');
    var els = [].slice.call(document.querySelectorAll('.scene'));
    els.forEach(function (el) {
      scenes.push({ el: el, start: Math.max(0, ref(el.dataset.beat, 0) - lead), tr: el.dataset.tr || 'fade' });
    });
    scenes.sort(function (a, b) { return a.start - b.start; });
    scenes.forEach(function (s, i) { s.end = i + 1 < scenes.length ? scenes[i + 1].start : TL.duration + 1; });

    scenes.forEach(function (s) {
      [].slice.call(s.el.querySelectorAll('[data-at],[data-count],[data-bar],[data-draw],[data-type],[data-mark]')).forEach(function (el) {
        var d = el.dataset;
        var it = { el: el, at: ref(d.at, s.start + 0.15), fx: d.fx || (d.at != null ? 'up' : 'none'), dur: parseFloat(d.d || '0.6'),
          off: d.off != null ? ref(d.off, s.start) : null, scene: s };
        if (d.count != null) {
          it.count = parseFloat(d.count); it.from = parseFloat(d.from || '0'); it.dec = parseInt(d.dec || '0', 10);
          it.cdur = parseFloat(d.cd || '1.2'); it.cat = d.cat != null ? ref(d.cat, s.start) : it.at;
          it.sep = d.sep != null;
        }
        if (d.bar != null) { it.bar = parseFloat(d.bar); it.bat = d.bat != null ? ref(d.bat, s.start) : it.at; it.bdur = parseFloat(d.bd || '1.0'); it.axis = d.axis || 'x'; }
        if (d.draw != null) { it.draw = true; it.len = el.getTotalLength ? el.getTotalLength() : 1000; it.dat = d.dat != null ? ref(d.dat, s.start) : it.at; it.ddur = parseFloat(d.dd || '1.0'); el.style.strokeDasharray = it.len; }
        if (d.type != null) { it.type = el.textContent; it.tat = d.tat != null ? ref(d.tat, s.start) : it.at; it.tdur = parseFloat(d.td || (it.type.length * 0.06).toFixed(2)); }
        if (d.mark != null) { it.mark = true; it.mat = d.mat != null ? ref(d.mat, s.start) : it.at + 0.3; }
        items.push(it);
      });
    });
    cap = document.getElementById('cap');
    capText = cap && cap.querySelector('span');
    progEl = document.getElementById('prog');
  }

  function fx(it, t) {
    var el = it.el, p = E.out(prog(t, it.at, it.dur)), o = p, tf = '';
    switch (it.fx) {
      case 'none': o = 1; break;
      case 'fade': break;
      case 'up': tf = 'translateY(' + (1 - p) * 46 + 'px)'; break;
      case 'down': tf = 'translateY(' + (p - 1) * 46 + 'px)'; break;
      case 'left': tf = 'translateX(' + (1 - p) * 80 + 'px)'; break;
      case 'right': tf = 'translateX(' + (p - 1) * 80 + 'px)'; break;
      case 'scale': tf = 'scale(' + (0.86 + 0.14 * p) + ')'; break;
      case 'pop': p = prog(t, it.at, it.dur); o = clamp(p * 3, 0, 1); tf = 'scale(' + (0.6 + 0.4 * E.back(p)) + ')'; break;
      case 'blur': tf = 'scale(' + (1.06 - 0.06 * p) + ')'; el.style.filter = 'blur(' + (1 - p) * 14 + 'px)'; break;
      case 'wipe': o = 1; el.style.clipPath = 'inset(0 ' + (1 - p) * 100 + '% 0 0)'; break;
      case 'wipeup': o = 1; el.style.clipPath = 'inset(' + (1 - p) * 100 + '% 0 0 0)'; break;
    }
    if (it.off != null) {
      var q = E.out(prog(t, it.off, 0.4));
      o *= 1 - q;
      if (q > 0) tf += ' translateY(' + (-q * 24) + 'px)';
    }
    if (it.fx !== 'none' || it.off != null) { el.style.opacity = o; el.style.transform = tf; }

    if (it.count != null) {
      var cp = E.out(prog(t, it.cat, it.cdur)), v = it.from + (it.count - it.from) * cp;
      var s = Math.abs(v).toFixed(it.dec);
      if (it.sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      el.textContent = (v < 0 ? '−' : '') + s;
    }
    if (it.bar != null) {
      var bp = E.inout(prog(t, it.bat, it.bdur)) * it.bar * 100;
      if (it.axis === 'y') el.style.height = bp + '%'; else el.style.width = bp + '%';
    }
    if (it.draw) el.style.strokeDashoffset = it.len * (1 - E.inout(prog(t, it.dat, it.ddur)));
    if (it.type != null) {
      var n = Math.round(it.type.length * prog(t, it.tat, it.tdur));
      el.textContent = it.type.slice(0, n);
    }
    if (it.mark) el.style.backgroundSize = E.inout(prog(t, it.mat, 0.5)) * 100 + '% 100%';
  }

  function scene(s, t) {
    var vis = t >= s.start - 0.01 && t < s.end + 0.3;
    s.el.style.display = vis ? 'block' : 'none';
    if (!vis) return;
    // 旧场景先快速淡出，新场景稍后淡入，减少两层文字叠在一起的时间
    var pin = E.out(prog(t, s.start + 0.1, 0.4)), pout = E.inout(prog(t, s.end, 0.25));
    var o = Math.min(pin, 1 - pout), tf = '';
    if (s.tr === 'slide') tf = 'translateY(' + ((1 - pin) * 60 - pout * 60) + 'px)';
    else if (s.tr === 'zoom') tf = 'scale(' + (1.04 - 0.04 * pin + 0.03 * pout) + ')';
    else if (s.tr === 'cut') o = t < s.end ? 1 : 0;
    s.el.style.opacity = o;
    s.el.style.transform = tf;
    s.el.style.zIndex = t < s.end ? 2 : 1;
  }

  // 字幕过长时在最靠近中间的标点处断行，避免把词拆开
  function vlen(s) { var n = 0; for (var i = 0; i < s.length; i++) n += /[\u0000-\u024f]/.test(s[i]) ? 0.55 : 1; return n; }
  function splitCap(s) {
    var max = +(cap.dataset.max || 0);
    if (!max || vlen(s) <= max) return s;
    var best = -1, bd = 1e9, half = vlen(s) / 2;
    for (var i = 1; i < s.length - 1; i++) {
      var c = s[i], cut = -1;
      if ('，：；、'.indexOf(c) >= 0) cut = i + 1;
      else if (c === '·' || c === '→' || (c === ' ' && s.substr(i + 1, 2) === 'vs')) cut = i;
      if (cut < 0) continue;
      var d = Math.abs(vlen(s.slice(0, cut)) - half);
      if (d < bd) { bd = d; best = cut; }
    }
    if (best < 0 || bd > half * 0.55) return s; // 断点太偏就交给 text-wrap:balance
    return s.slice(0, best).trim() + '\n' + s.slice(best).replace(/^\s*·\s*/, '').trim();
  }

  function caption(t) {
    if (!cap) return;
    var L = TL.lines, cur = null;
    for (var i = 0; i < L.length; i++) {
      var next = L[i + 1], hold = next && next.start - L[i].end < 0.6 ? next.start : L[i].end + 0.25;
      if (t >= L[i].start - 0.08 && t < hold) { cur = L[i]; break; }
    }
    if (!cur || cur.cap === '') { cap.style.opacity = 0; return; }
    var txt = splitCap(cur.cap);
    if (capText.textContent !== txt) capText.textContent = txt;
    cap.style.opacity = Math.min(1, (t - cur.start + 0.08) / 0.12);
  }

  window.seek = function (t) {
    scenes.forEach(function (s) { scene(s, t); });
    items.forEach(function (it) {
      if (t >= it.scene.start - 0.05 && t < it.scene.end + 0.5) fx(it, t);
    });
    caption(t);
    if (progEl) progEl.style.width = (t / TL.duration) * 100 + '%';
    HOOKS.forEach(function (h) { h(t); });
  };

  window.READY = (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () {
    init();
    window.seek(0);
    return { duration: TL.duration, fps: TL.fps, w: TL.w, h: TL.h };
  });

  // 浏览器里直接打开时：实时预览（空格暂停，左右方向键跳 2 秒）
  if (!/render=1/.test(location.search)) {
    window.READY.then(function () {
      var t0 = performance.now(), off = +(location.hash.slice(1) || 0), paused = false, pt = 0;
      function loop() { if (!paused) { var t = off + (performance.now() - t0) / 1000; if (t > TL.duration) { t0 = performance.now(); off = 0; t = 0; } window.seek(t); pt = t; } requestAnimationFrame(loop); }
      addEventListener('keydown', function (e) {
        if (e.key === ' ') { paused = !paused; if (!paused) { t0 = performance.now(); off = pt; } }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { off = pt + (e.key === 'ArrowRight' ? 2 : -2); t0 = performance.now(); pt = off; window.seek(pt); }
      });
      function fit() { var s = Math.min(innerWidth / TL.w, innerHeight / TL.h); document.documentElement.style.setProperty('--fit', s); }
      fit(); addEventListener('resize', fit);
      document.documentElement.classList.add('preview');
      loop();
    });
  }
})();
