#!/usr/bin/env node
/* 逐帧渲染：打开样片页面 → 每帧调用 window.seek(t) → 截图 → 管道交给 ffmpeg 编码。
 * 用法：node render.js <样片目录> <输出.mp4> [--from 秒] [--to 秒] [--stills 秒,秒,...]
 * 页面需暴露 window.VIDEO = { w, h, fps, duration } 和 window.seek(t)。
 * 同时把 window.VIDEO.cues（音效提示点）写到 <输出>.cues.json，供配乐脚本使用。
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dir = path.resolve(args[0]);
const out = path.resolve(args[1]);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

(async () => {
  const browser = await chromium.launch();
  const html = path.join(dir, 'index.html');
  const probe = await browser.newPage();
  await probe.goto('file://' + html);
  const meta = await probe.evaluate(() => ({ w: VIDEO.w, h: VIDEO.h, fps: VIDEO.fps, duration: VIDEO.duration }));
  await probe.close();

  const page = await browser.newPage({ viewport: { width: meta.w, height: meta.h }, deviceScaleFactor: 1 });
  await page.goto('file://' + html);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (window.ready ? window.ready() : null));

  const v = await page.evaluate(() => ({ cues: VIDEO.cues || [], music: VIDEO.music || null, duration: VIDEO.duration }));
  fs.writeFileSync(out + '.cues.json', JSON.stringify(v, null, 1));

  const stills = opt('--stills', null);
  if (stills) {
    for (const s of stills.split(',')) {
      const t = parseFloat(s);
      await page.evaluate((t) => window.seek(t), t);
      await page.screenshot({ path: out.replace(/\.mp4$/, '') + `-t${t.toFixed(1)}.jpg`, type: 'jpeg', quality: 88 });
    }
    await browser.close();
    return;
  }

  const fps = meta.fps;
  const from = parseFloat(opt('--from', 0));
  const to = Math.min(parseFloat(opt('--to', meta.duration)), meta.duration);
  const n = Math.round((to - from) * fps);

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));

  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    const t = from + f / fps;
    await page.evaluate((t) => window.seek(t), t);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, captureBeyondViewport: false });
    await write(Buffer.from(data, 'base64'));
    if (f % (fps * 5) === 0) process.stdout.write(`\r${path.basename(dir)} ${f}/${n} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((res) => ff.on('close', res));
  await browser.close();
  console.log(`\n${path.basename(out)}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch((e) => { console.error(e); process.exit(1); });
