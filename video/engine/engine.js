/* 准讯周报 · 视频样片引擎（无依赖）
 * 所有画面都由 seek(t) 按时间直接算出来——同一个 t 永远得到同一帧，方便逐帧渲染。
 */
window.V = (function () {
  'use strict';
  var clamp = function (x, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return Math.min(b, Math.max(a, x)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var prog = function (t, a, b) { return clamp((t - a) / (b - a)); };
  var ease = {
    lin: function (t) { return t; },
    out2: function (t) { return 1 - (1 - t) * (1 - t); },
    out3: function (t) { return 1 - Math.pow(1 - t, 3); },
    out5: function (t) { return 1 - Math.pow(1 - t, 5); },
    in3: function (t) { return t * t * t; },
    inOut3: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    outBack: function (t) { var c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  };

  /* 把元素里的文字拆成一个字一个 span（保留 <b>、<em> 等包裹） */
  function split(el) {
    var out = [];
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          Array.from(c.textContent).forEach(function (ch) {
            var s = document.createElement('span');
            s.className = 'ch'; s.textContent = ch;
            if (ch === ' ') s.style.whiteSpace = 'pre';
            frag.appendChild(s); out.push(s);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== 'BR') walk(c);
      });
    })(el);
    return out;
  }

  /* 逐字出现：p 从 0 到 1；width 是单个字的动画占比 */
  function reveal(spans, p, o) {
    o = o || {};
    var n = spans.length, w = o.width || 0.25, dy = o.dy === undefined ? 0.35 : o.dy, blur = o.blur || 0, sc = o.scale || 0;
    for (var i = 0; i < n; i++) {
      var st = n > 1 ? (i / (n - 1)) * (1 - w) : 0;
      var q = (o.ease || ease.out3)(clamp((p - st) / w));
      var s = spans[i].style;
      s.opacity = q;
      var tr = 'translateY(' + ((1 - q) * dy).toFixed(3) + 'em)';
      if (sc) tr += ' scale(' + (1 + (1 - q) * sc).toFixed(3) + ')';
      s.transform = tr;
      if (blur) s.filter = q < 1 ? 'blur(' + ((1 - q) * blur).toFixed(2) + 'px)' : 'none';
    }
  }

  /* 数字格式：千分位 + 小数位 */
  function fmt(x, d, sep) {
    var s = x.toFixed(d || 0), p = s.split('.');
    if (sep !== false) p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep || ',');
    return p.join('.');
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function css(el, o) { for (var k in o) el.style[k] = o[k]; return el; }
  function show(el, on) { el.style.visibility = on ? 'visible' : 'hidden'; }

  /* 胶片颗粒：一张预生成的噪点贴图，每帧按帧号换位置 */
  function grain(parent, opacity, size) {
    var c = document.createElement('canvas'); size = size || 256;
    c.width = c.height = size;
    var g = c.getContext('2d'), img = g.createImageData(size, size), seed = 7;
    for (var i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      var v = seed % 256;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var d = document.createElement('div');
    d.className = 'grain';
    css(d, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: 50, opacity: opacity,
      backgroundImage: 'url(' + c.toDataURL() + ')', mixBlendMode: 'overlay' });
    parent.appendChild(d);
    return function (frame) {
      var x = (frame * 97) % size, y = (frame * 61) % size;
      d.style.backgroundPosition = x + 'px ' + y + 'px';
    };
  }

  /* 时间线：场景按顺序排，每个场景一个 <section>，render(lt, dur) 只管自己 */
  function Film(o) {
    this.w = o.w; this.h = o.h; this.fps = o.fps || 30; this.music = o.music;
    this.root = o.root; this.scenes = []; this.cues = []; this.t = 0; this.overlays = [];
  }
  Film.prototype.scene = function (dur, el, render, o) {
    o = o || {};
    var start = this.t - (o.overlap || 0);
    var sc = { start: start, dur: dur, el: el, render: render, pre: o.pre || 0, post: o.post === undefined ? 0.6 : o.post };
    this.scenes.push(sc);
    this.t = start + dur;
    (o.cues || []).forEach(function (c) { this.cue(start + c[0], c[1], c[2]); }, this);
    return sc;
  };
  Film.prototype.cue = function (t, type, v) { this.cues.push({ t: +t.toFixed(3), type: type, v: v === undefined ? 1 : v }); };
  Film.prototype.overlay = function (fn) { this.overlays.push(fn); };
  Film.prototype.seek = function (t) {
    var frame = Math.round(t * this.fps);
    this.scenes.forEach(function (s) {
      var lt = t - s.start, on = lt >= -s.pre && lt < s.dur + s.post;
      show(s.el, on);
      if (on) s.render(lt, s.dur);
    });
    this.overlays.forEach(function (fn) { fn(t, frame); });
  };
  Film.prototype.publish = function (extra) {
    var self = this;
    this.cues.sort(function (a, b) { return a.t - b.t; });
    window.VIDEO = Object.assign({ w: this.w, h: this.h, fps: this.fps, duration: +this.t.toFixed(3), cues: this.cues, music: this.music }, extra || {});
    window.seek = function (t) { self.seek(t); };
    /* 浏览器里直接打开时：自动播放预览（无声），按空格暂停，←/→ 跳 1 秒 */
    if (!navigator.webdriver) {
      var t0 = performance.now(), paused = false, at = 0;
      var fit = function () {
        var k = Math.min(innerWidth / self.w, innerHeight / self.h);
        css(self.root, { transform: 'scale(' + k + ')', transformOrigin: '0 0' });
      };
      fit(); addEventListener('resize', fit);
      addEventListener('keydown', function (e) {
        if (e.code === 'Space') { paused = !paused; t0 = performance.now() - at * 1000; }
        if (e.code === 'ArrowRight') { at += 1; t0 -= 1000; }
        if (e.code === 'ArrowLeft') { at = Math.max(0, at - 1); t0 += 1000; }
      });
      (function loop() {
        if (!paused) at = ((performance.now() - t0) / 1000) % window.VIDEO.duration;
        self.seek(at); requestAnimationFrame(loop);
      })();
    } else self.seek(0);
  };

  return { clamp: clamp, lerp: lerp, prog: prog, ease: ease, split: split, reveal: reveal, fmt: fmt,
    $: $, $$: $$, css: css, show: show, grain: grain, Film: Film };
})();
