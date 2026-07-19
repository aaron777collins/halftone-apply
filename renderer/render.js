#!/usr/bin/env node
/* =========================================================================
   render.js — Halftone EXACT-match offline renderer.

   Runs a video through the SAME WebGL comic-stylization pipeline as the
   "Halftone" tuner web app (see renderer.html) and encodes an MP4 whose look
   is pixel-faithful to the tuner's on-screen preview — not ffmpeg's
   approximation of it.

   Usage:
     node render.js "C:\path\to\video.mp4"  [--out out.mp4]   [--sat 1.6] ...
     node render.js "C:\path\to\folder"     [--out out_dir]   [--sat 1.6] ...

   Single file  -> "<name>_comic.mp4" next to the input (unless --out given).
   Folder       -> every video in it (mp4/mov/mkv/avi/webm/m4v, non-recursive)
                   rendered to an "output/" subfolder (or --out <dir> if given).
                   One Chromium/WebGL context is reused across all files, so a
                   batch is fast; a single file's failure is logged and the
                   batch continues.

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

// Video extensions we batch over in folder mode (case-insensitive).
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']);

// ---- puppeteer (bundled Chromium), with puppeteer-core fallback ------------
// Returns the puppeteer module and whether it's the full package (bundled
// Chromium) or puppeteer-core (needs an explicit executablePath).
function loadPuppeteer() {
  try {
    const puppeteer = require('puppeteer');
    return { puppeteer, isCore: false, which: 'puppeteer (bundled Chromium)' };
  } catch (e) {
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
    if (!findChrome()) {
      fail('puppeteer-core is present but no installed Chrome was found. Run `npm install` (for bundled Chromium) or install Google Chrome.');
    }
    return { puppeteer: core, isCore: true, which: 'puppeteer-core + installed Chrome' };
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

// ===========================================================================
// GPU launch configs + auto-detection.
//
// Chrome 137+ dropped the automatic SwiftShader fallback and, on laptops with
// switchable graphics (NVIDIA Optimus), ANGLE's d3d11 backend defaults to the
// low-power integrated GPU. The KEY flag that engages the discrete NVIDIA GPU
// is `--force-high-performance-gpu`; `--use-angle=d3d11 --enable-gpu
// --ignore-gpu-blocklist` turn on real hardware WebGL in the first place.
//
// We try configs in priority order and keep the FIRST that reports a HARDWARE
// renderer string, falling back to SwiftShader software so the tool still runs
// on a machine with no usable GPU.
// ===========================================================================
const BASE_ARGS  = ['--no-sandbox', '--disable-dev-shm-usage'];
const GPU_ARGS   = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force-high-performance-gpu'];
const OFFSCREEN  = ['--window-position=-3000,-3000', '--window-size=1280,720'];
const SWIFT_ARGS = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];

// Build the ordered list of GPU launch configs to try. `chrome` is the path to
// an installed Chrome (or null if none found).
function gpuConfigs(isCore, chrome) {
  const list = [];
  // Bundled Chromium (skipped when only puppeteer-core is available).
  if (!isCore) {
    list.push({ name: 'bundled-headless', launch: { headless: true,  args: [...BASE_ARGS, ...GPU_ARGS] } });
    list.push({ name: 'bundled-headful',  launch: { headless: false, args: [...BASE_ARGS, ...GPU_ARGS, ...OFFSCREEN] } });
  }
  // Installed Chrome (usually the most reliable GPU drivers).
  if (chrome) {
    list.push({ name: 'chrome-headless', launch: { headless: true,  executablePath: chrome, args: [...BASE_ARGS, ...GPU_ARGS] } });
    list.push({ name: 'chrome-headful',  launch: { headless: false, executablePath: chrome, args: [...BASE_ARGS, ...GPU_ARGS, ...OFFSCREEN] } });
  }
  return list;
}

function softwareConfig(isCore, chrome) {
  const launch = { headless: true, args: [...BASE_ARGS, ...SWIFT_ARGS] };
  if (isCore && chrome) launch.executablePath = chrome;
  return { name: 'software-swiftshader', launch };
}

// Classify a WebGL UNMASKED_RENDERER_WEBGL string.
function classifyRenderer(r) {
  if (!r) return 'UNKNOWN';
  const s = String(r).toLowerCase();
  if (s.includes('swiftshader') || s.includes('software') || s.includes('llvmpipe') || s.includes('basic render'))
    return 'SOFTWARE';
  if (s.includes('nvidia') || s.includes('geforce') || s.includes('rtx') || s.includes('radeon') ||
      s.includes('amd') || s.includes('intel') || s.includes('direct3d11') || s.includes('metal') ||
      s.includes('opengl'))
    return 'HARDWARE';
  return 'UNKNOWN';
}

// Launch a browser with a given config, load renderer.html, and read the live
// WebGL renderer string. Returns { browser, page, info } or throws.
async function launchAndProbe(puppeteer, launch) {
  const browser = await puppeteer.launch(launch);
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('      [page error] ' + e.message));
    const htmlPath = 'file://' + path.join(__dirname, 'renderer.html').replace(/\\/g, '/');
    await page.goto(htmlPath, { waitUntil: 'load' });
    await page.waitForFunction('window.__HT_READY === true', { timeout: 20000 });
    const info = await page.evaluate(() => window.HT.glinfo());
    return { browser, page, info };
  } catch (e) {
    try { await browser.close(); } catch (e2) {}
    throw e;
  }
}

// Acquire a ready browser + page using the best available config.
// opts.cpu forces software; opts['gpu-mode'] forces a named config for
// debugging. Returns { browser, page, mode, renderer, hardware }.
async function acquireBrowser(puppeteer, isCore, chrome, opts) {
  const forceCpu  = !!opts.cpu || String(process.env.HALFTONE_GPU || '').toLowerCase() === 'cpu';
  const forceMode = opts['gpu-mode'] || process.env.HALFTONE_GPU_MODE || null;

  const sw = softwareConfig(isCore, chrome);

  if (forceCpu) {
    console.log('GPU: forced software (SwiftShader) via --cpu/HALFTONE_GPU=cpu.');
    const r = await launchAndProbe(puppeteer, sw.launch);
    console.log('     renderer: ' + r.info.renderer);
    return { browser: r.browser, page: r.page, mode: sw.name, renderer: r.info.renderer, hardware: false };
  }

  let candidates = gpuConfigs(isCore, chrome);
  if (forceMode) {
    const all = [...candidates, sw];
    const picked = all.find(c => c.name === forceMode);
    if (!picked) fail('Unknown --gpu-mode "' + forceMode + '". Valid: ' + all.map(c => c.name).join(', '));
    console.log('GPU: forced mode "' + forceMode + '".');
    const r = await launchAndProbe(puppeteer, picked.launch);
    console.log('     renderer: ' + r.info.renderer + '  [' + classifyRenderer(r.info.renderer) + ']');
    return { browser: r.browser, page: r.page, mode: picked.name, renderer: r.info.renderer,
             hardware: classifyRenderer(r.info.renderer) === 'HARDWARE' };
  }

  console.log('GPU: auto-detecting hardware WebGL...');
  for (const cfg of candidates) {
    try {
      const r = await launchAndProbe(puppeteer, cfg.launch);
      const cls = classifyRenderer(r.info.renderer);
      console.log('     [' + cfg.name + '] ' + cls + '  ' + r.info.renderer);
      if (cls === 'HARDWARE') {
        console.log('GPU: engaged hardware WebGL via "' + cfg.name + '".');
        return { browser: r.browser, page: r.page, mode: cfg.name, renderer: r.info.renderer, hardware: true };
      }
      try { await r.browser.close(); } catch (e) {}
    } catch (e) {
      console.log('     [' + cfg.name + '] launch failed: ' + ((e && e.message) || e));
    }
  }

  console.warn('GPU: WARNING — no config engaged the GPU; falling back to SwiftShader software (slow).');
  const r = await launchAndProbe(puppeteer, sw.launch);
  console.log('     renderer: ' + r.info.renderer);
  return { browser: r.browser, page: r.page, mode: sw.name, renderer: r.info.renderer, hardware: false };
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
  if (r.status !== 0) throw new Error('ffprobe failed:\n' + (r.stderr || r.error));
  const j = JSON.parse(r.stdout);
  const s = j.streams && j.streams[0];
  if (!s) throw new Error('No video stream found in input.');
  // audio?
  const ra = run('ffprobe', ['-v','error','-select_streams','a','-show_entries','stream=codec_name','-of','json', input]);
  let hasAudio = false;
  try { const ja = JSON.parse(ra.stdout); hasAudio = !!(ja.streams && ja.streams.length); } catch (e) {}
  return { w: s.width, h: s.height, fps: s.r_frame_rate || '30/1', hasAudio };
}

// List the video files in a directory (non-recursive, case-insensitive ext).
function listVideos(dir) {
  return fs.readdirSync(dir)
    .filter(name => {
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch (e) { return false; }
      return st.isFile() && VIDEO_EXTS.has(path.extname(name).toLowerCase());
    })
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(name => path.join(dir, name));
}

// ---------------------------------------------------------------------------
// Render ONE video through the already-open page. Throws on failure so the
// batch caller can log-and-continue. `label` prefixes progress lines.
// ---------------------------------------------------------------------------
async function renderOne(page, inItem, out, cfg, label) {
  const meta = ffprobe(inItem);
  const srcW = meta.w, srcH = meta.h;
  const scale = Math.min(1, MAXW / srcW);
  const procW = Math.round(srcW * scale);
  const procH = Math.round(srcH * scale);

  console.log(label + path.basename(inItem) + '  ->  ' + out);
  console.log('        source ' + srcW + 'x' + srcH + '  fps ' + meta.fps +
              (meta.hasAudio ? '  (has audio)' : '  (no audio)') +
              '   process ' + procW + 'x' + procH + '  (MAXW=' + MAXW + ' cap)');

  // Temp dirs OUTSIDE the repo (system TEMP) so nothing lands in git.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'halftone-'));
  const framesDir = path.join(work, 'frames');
  const procDir   = path.join(work, 'processed');
  fs.mkdirSync(framesDir); fs.mkdirSync(procDir);

  try {
    // --- 1. Decode frames at proc resolution -------------------------------
    let r = run('ffmpeg', [
      '-y', '-i', inItem,
      '-vf', 'scale=' + procW + ':' + procH + ':flags=lanczos',
      path.join(framesDir, '%06d.png')
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) throw new Error('ffmpeg frame decode failed.');
    const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
    if (!frames.length) throw new Error('No frames were decoded.');

    // --- 2. (Re)init the WebGL context at this file's proc size ------------
    const info = await page.evaluate((w, h, c) => window.HT.init(w, h, c), procW, procH, cfg);
    if (info.PW !== procW || info.PH !== procH) throw new Error('GL init size mismatch.');

    // --- 3. Run the WebGL pipeline per frame -------------------------------
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
        process.stdout.write('\r        frame ' + (i + 1) + '/' + frames.length + '  (' + pct + '%)  ' + rate + ' fps   ');
      }
    }
    process.stdout.write('\n');

    // --- 4. Encode: upscale back to source res, mux original audio ---------
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
    if (r.status !== 0) throw new Error('ffmpeg encode failed.');
    if (!fs.existsSync(out)) throw new Error('Encode reported success but output not found.');
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
(async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const input = positional[0];
  if (!input) fail('No input provided.\nUsage: node render.js "C:\\path\\to\\video.mp4"  (or a folder)  [--out <dir>]');
  if (!fs.existsSync(input)) fail('Input not found: ' + input);

  // Verify ffmpeg/ffprobe present (once).
  if (run('ffmpeg',  ['-version']).status !== 0) fail('ffmpeg not found on PATH.');
  if (run('ffprobe', ['-version']).status !== 0) fail('ffprobe not found on PATH.');

  // Build config from defaults + overrides.
  const cfg = Object.assign({}, DEFAULTS);
  for (const k of ['sat','con','thr','op']) if (opts[k] != null) cfg[k] = parseFloat(opts[k]);
  for (const k of ['rad','pass','lev','thick']) if (opts[k] != null) cfg[k] = parseInt(opts[k], 10);
  if (opts.edges != null) cfg.edges = !!opts.edges;

  const inPath = path.resolve(input);
  const isDir = fs.statSync(inPath).isDirectory();

  // Build the work list: [{ in, out }].
  const jobs = [];
  if (isDir) {
    const files = listVideos(inPath);
    if (!files.length) fail('No video files (mp4/mov/mkv/avi/webm/m4v) found in folder: ' + inPath);
    const outDir = opts.out ? path.resolve(opts.out) : path.join(inPath, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of files) {
      const base = path.basename(f, path.extname(f));
      jobs.push({ in: f, out: path.join(outDir, base + '_comic.mp4') });
    }
  } else {
    // Single-file mode — unchanged behavior: --out is a FILE path, else write
    // "<name>_comic.mp4" next to the input.
    const dir  = path.dirname(inPath);
    const base = path.basename(inPath, path.extname(inPath));
    const out  = opts.out ? path.resolve(opts.out) : path.join(dir, base + '_comic.mp4');
    jobs.push({ in: inPath, out });
  }

  console.log('Halftone exact-match renderer');
  console.log('  mode     : ' + (isDir ? 'folder (' + jobs.length + ' video' + (jobs.length === 1 ? '' : 's') + ')' : 'single file'));
  if (isDir) console.log('  input dir: ' + inPath);
  console.log('  output   : ' + (isDir ? path.dirname(jobs[0].out) : jobs[0].out));
  console.log('  settings : sat=' + cfg.sat + ' con=' + cfg.con + ' rad=' + cfg.rad + ' pass=' + cfg.pass +
              ' lev=' + cfg.lev + ' thr=' + cfg.thr + ' thick=' + cfg.thick + ' op=' + cfg.op + ' edges=' + cfg.edges);
  console.log('');

  // Launch ONE Chromium + WebGL context, reused across every file. Auto-detect
  // the best GPU config once; renderer.html is already loaded on the returned
  // page (its WebGL context was probed during detection).
  const { puppeteer, isCore, which } = loadPuppeteer();
  const chrome = findChrome();
  console.log('Engine: ' + which);
  const acq = await acquireBrowser(puppeteer, isCore, chrome, opts);
  const browser = acq.browser;
  const page = acq.page;
  console.log('Renderer: ' + acq.renderer + '   (' + (acq.hardware ? 'HARDWARE GPU' : 'SOFTWARE') + ', mode=' + acq.mode + ')');
  console.log('');

  let processed = 0;
  const failures = [];
  try {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const label = '[' + (i + 1) + '/' + jobs.length + '] ';
      try {
        await renderOne(page, job.in, job.out, cfg, label);
        processed++;
        console.log('      OK  ->  ' + job.out + '\n');
      } catch (e) {
        failures.push({ file: job.in, error: (e && e.message) || String(e) });
        console.error('      FAILED: ' + path.basename(job.in) + '  —  ' + ((e && e.message) || String(e)) + '\n');
        // A single file's failure must not abort the batch.
      }
    }
  } finally {
    try { await browser.close(); } catch (e) {}
  }

  // ---- Summary -------------------------------------------------------------
  console.log('===============================================');
  console.log('Done. ' + processed + '/' + jobs.length + ' processed' +
              (failures.length ? ', ' + failures.length + ' failed' : '') + '.');
  if (failures.length) {
    for (const fl of failures) console.log('  FAILED: ' + fl.file + '  —  ' + fl.error);
  }
  if (!isDir && processed === 1) {
    console.log('SUCCESS  ->  ' + jobs[0].out);
  }
  // Non-zero exit only if EVERYTHING failed (so a partial batch still "succeeds").
  if (processed === 0) process.exit(1);
})().catch(e => { fail((e && e.stack) || String(e)); });
