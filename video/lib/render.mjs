#!/usr/bin/env node
// 逐帧渲染 scene.html → MP4。
//   node render.mjs <sample_dir>                 渲染完整视频（含混音）
//   node render.mjs <sample_dir> --stills 1,5,9  只截几张静帧到 build/stills/ 用于检查
//   --workers N  并行页面数（默认 3）
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// 用 require 解析，这样全局安装（NODE_PATH）的 playwright 也能找到
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const dir = path.resolve(args[0]);
const opt = (k, d) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : d; };
const build = path.join(dir, 'build');
const tl = JSON.parse(fs.readFileSync(path.join(build, 'timeline.json'), 'utf8'));
const url = pathToFileURL(path.join(dir, 'scene.html')).href + '?render=1';

function run(cmd, a, input) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, a, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('close', c => (c === 0 ? res() : rej(new Error(cmd + ' failed: ' + err.slice(-2000)))));
    if (input) input(p);
  });
}

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: tl.w, height: tl.h }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exit(1); });
  await page.goto(url);
  await page.evaluate(() => window.READY);
  const cdp = await page.context().newCDPSession(page);
  return { page, cdp };
}

const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
try {
  const stills = opt('--stills');
  if (stills) {
    const out = path.join(build, 'stills');
    fs.mkdirSync(out, { recursive: true });
    const { page } = await openPage(browser);
    for (const s of stills.split(',')) {
      const t = parseFloat(s);
      await page.evaluate(t => window.seek(t), t);
      await page.screenshot({ path: path.join(out, `t${t.toFixed(1).padStart(5, '0')}.png`) });
    }
    console.log('stills →', out);
  } else {
    const fps = tl.fps, N = Math.ceil(tl.duration * fps), W = +opt('--workers', 3);
    const chunk = Math.ceil(N / W), segs = [];
    const t0 = Date.now();
    let done = 0;
    await Promise.all(Array.from({ length: W }, async (_, k) => {
      const a = k * chunk, b = Math.min(N, a + chunk);
      if (a >= b) return;
      const seg = path.join(build, `seg${k}.mp4`); segs[k] = seg;
      const { cdp, page } = await openPage(browser);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(fps), seg], async p => {
        for (let f = a; f < b; f++) {
          await page.evaluate(t => window.seek(t), f / fps);
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: true });
          if (!p.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => p.stdin.once('drain', r));
          if (++done % 150 === 0) process.stdout.write(`  ${done}/${N} 帧 ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
        }
        p.stdin.end();
      });
    }));
    const list = path.join(build, 'segs.txt');
    fs.writeFileSync(list, segs.filter(Boolean).map(s => `file '${s}'`).join('\n'));
    const silent = path.join(build, 'video.mp4');
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
    const name = opt('--out', path.basename(dir) + '.mp4');
    const outDir = path.join(dir, '..', 'out'); fs.mkdirSync(outDir, { recursive: true });
    const final = path.join(outDir, name);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', path.join(build, 'mix.wav'), '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest',
      '-movflags', '+faststart', final]);
    console.log(`完成 ${final}（${N} 帧，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  }
} finally {
  await browser.close();
}
