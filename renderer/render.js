#!/usr/bin/env node
/* =========================================================================
   render.js — Halftone EXACT-match offline renderer.

   Runs a video through the SAME WebGL comic-stylization pipeline as the
   "Halftone" tuner web app (see renderer.html) and encodes an MP4 whose look
   is pixel-faithful to the tuner's on-screen preview — not ffmpeg's
   approximation of it.

   Usage:
     node render.js "C:\path\to\video.mp4" [--out out.mp4] [--sat 1.6] ...

   Output: "<name>_comic.mp4" next to the input (unless --out given).

   Requirements:
     - Node + `npm install` already run in this folder (puppeteer + Chromium).
     - ffmpeg / ffprobe on PATH.
   ========================================================================= */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ---- Favorite defaults (match the tuner's current defaults) ----------------
const DEFAULTS = {
  sat: 1.60, con: 1.55, rad: 6, pass: 2, lev: 12,
  thr: 0.80, thick: 1, op: 0.85, edges: true
};
const MAXW = 1100; // must match the tuner's resize() cap exactly.

// ---- puppeteer (bundled Chromium), with puppeteer-core fallback ------------
function loadPuppeteer() {
  try {
    const puppeteer = require('puppeteer');
    return { puppeteer, launchOpts: {}, which: 'puppeteer (bundled Chromium)' };
  } catch (e) {
    // Fall back to puppeteer-core + an installed Chrome.
    let core;
    try { core = require('puppeteer-core'); }
    catch (e2) {
      fail(
        'Could not load puppeteer.\n' +
        'This tool needs its dependencies installed once:\n' +
        '    cd "' + __dirname + '"\n' +
        '    npm install\n'
      );
    }
    const chrome = findChrome();
    if (!chrome) {
      fail('puppeteer-core is present but no installed Chrome was found. Run `npm install` (for bundled Chromium) or install Google Chrome.');
    }
    return { puppeteer: core, launchOpts: { executablePath: chrome }, which: 'puppeteer-core + ' + chrome };
  }
}

function findChrome() {
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return null;
}

function fail(msg) {
  console.error('\nERROR: ' + msg + '\n');
  process.exit(1);
}

// ---- tiny arg parser -------------------------------------------------------
function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'no-edges') { opts.edges = false; continue; }
      if (key === 'edges')    { opts.edges = true;  continue; }
      const val = argv[++i];
      opts[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
  return r;
}

function ffprobe(input) {
  const r = run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json', input
  ]);
  if (r.status !== 0) fail('ffprobe failed:\n' + (r.stderr || r.error));
  const j = JSON.parse(r.stdout);
  const s = j.streams && j.streams[0];
  if (!s) fail('No video stream found in input.');
  // audio?
  const ra = run('ffprobe', ['-v','error','-select_streams','a','-show_entries','stream=codec_name','-of','json', input]);
  let hasAudio = false;
  try { const ja = JSON.parse(ra.stdout); hasAudio = !!(ja.streams && ja.streams.length); } catch (e) {}
  return { w: s.width, h: s.height, fps: s.r_frame_rate || '30/1', hasAudio };
}

// ---------------------------------------------------------------------------
(async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const input = positional[0];
  if (!input) fail('No input file provided.\nUsage: node render.js "C:\\path\\to\\video.mp4"');
  if (!fs.existsSync(input)) fail('Input file not found: ' + input);

  // Verify ffmpeg/ffprobe present.
  if (run('ffmpeg',  ['-version']).status !== 0) fail('ffmpeg not found on PATH.');
  if (run('ffprobe', ['-version']).status !== 0) fail('ffprobe not found on PATH.');

  // Build config from defaults + overrides.
  const cfg = Object.assign({}, DEFAULTS);
  for (const k of ['sat','con','thr','op']) if (opts[k] != null) cfg[k] = parseFloat(opts[k]);
  for (const k of ['rad','pass','lev','thick']) if (opts[k] != null) cfg[k] = parseInt(opts[k], 10);
  if (opts.edges != null) cfg.edges = !!opts.edges;

  const meta = ffprobe(input);
  const srcW = meta.w, srcH = meta.h;
  const scale = Math.min(1, MAXW / srcW);
  const procW = Math.round(srcW * scale);
  const procH = Math.round(srcH * scale);

  const inItem = path.resolve(input);
  const dir  = path.dirname(inItem);
  const base = path.basename(inItem, path.extname(inItem));
  const out  = opts.out ? path.resolve(opts.out) : path.join(dir, base + '_comic.mp4');

  console.log('Halftone exact-match renderer');
  console.log('  input   : ' + inItem);
  console.log('  output  : ' + out);
  console.log('  source  : ' + srcW + 'x' + srcH + '  fps ' + meta.fps + (meta.hasAudio ? '  (has audio)' : '  (no audio)'));
  console.log('  process : ' + procW + 'x' + procH + '  (MAXW=' + MAXW + ' cap, matches tuner preview)');
  console.log('  settings: sat=' + cfg.sat + ' con=' + cfg.con + ' rad=' + cfg.rad + ' pass=' + cfg.pass +
              ' lev=' + cfg.lev + ' thr=' + cfg.thr + ' thick=' + cfg.thick + ' op=' + cfg.op + ' edges=' + cfg.edges);
  console.log('');

  // Temp dirs OUTSIDE the repo (system TEMP) so nothing lands in git.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'halftone-'));
  const framesDir = path.join(work, 'frames');
  const procDir   = path.join(work, 'processed');
  fs.mkdirSync(framesDir); fs.mkdirSync(procDir);

  let page, browser;
  try {
    // --- 1. Decode frames at proc resolution -------------------------------
    console.log('[1/3] Decoding frames at ' + procW + 'x' + procH + ' ...');
    let r = run('ffmpeg', [
      '-y', '-i', inItem,
      '-vf', 'scale=' + procW + ':' + procH + ':flags=lanczos',
      path.join(framesDir, '%06d.png')
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) fail('ffmpeg frame decode failed.');
    const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
    if (!frames.length) fail('No frames were decoded.');
    console.log('      ' + frames.length + ' frames.');

    // --- 2. Launch Chromium + run the WebGL pipeline per frame --------------
    console.log('[2/3] Rendering through the WebGL pipeline ...');
    const { puppeteer, launchOpts, which } = loadPuppeteer();
    console.log('      engine: ' + which);
    browser = await puppeteer.launch(Object.assign({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--ignore-gpu-blocklist',
      ],
    }, launchOpts));
    page = await browser.newPage();
    page.on('pageerror', e => console.error('      [page error] ' + e.message));
    const htmlPath = 'file://' + path.join(__dirname, 'renderer.html').replace(/\\/g, '/');
    await page.goto(htmlPath, { waitUntil: 'load' });
    await page.waitForFunction('window.__HT_READY === true', { timeout: 20000 });

    const info = await page.evaluate((w, h, c) => window.HT.init(w, h, c), procW, procH, cfg);
    if (info.PW !== procW || info.PH !== procH) fail('GL init size mismatch.');

    const t0 = Date.now();
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const dataURL = 'data:image/png;base64,' + fs.readFileSync(path.join(framesDir, f)).toString('base64');
      const outURL = await page.evaluate(u => window.HT.process(u), dataURL);
      const b64 = outURL.slice(outURL.indexOf(',') + 1);
      fs.writeFileSync(path.join(procDir, f), Buffer.from(b64, 'base64'));
      if ((i + 1) % 15 === 0 || i === frames.length - 1) {
        const pct = (((i + 1) / frames.length) * 100).toFixed(0);
        const rate = ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(1);
        process.stdout.write('\r      frame ' + (i + 1) + '/' + frames.length + '  (' + pct + '%)  ' + rate + ' fps   ');
      }
    }
    process.stdout.write('\n');
    await browser.close(); browser = null;

    // --- 3. Encode: upscale back to source res, mux original audio ---------
    console.log('[3/3] Encoding MP4 (scaling back to ' + srcW + 'x' + srcH + ', flags=lanczos) ...');
    const encArgs = [
      '-y',
      '-framerate', meta.fps,
      '-i', path.join(procDir, '%06d.png'),
      '-i', inItem,
      '-map', '0:v',
      '-map', '1:a?',
      '-vf', 'scale=' + srcW + ':' + srcH + ':flags=lanczos',
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-shortest',
      out
    ];
    r = run('ffmpeg', encArgs, { stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) fail('ffmpeg encode failed.');

    if (!fs.existsSync(out)) fail('Encode reported success but output not found.');
    console.log('');
    console.log('SUCCESS  ->  ' + out);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
    // Clean up temp frame dirs.
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  }
})().catch(e => { fail((e && e.stack) || String(e)); });
