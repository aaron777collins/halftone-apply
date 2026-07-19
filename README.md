# Halftone — Right-click "Apply Comic Style" for Windows

Right-click any video file in Windows Explorer, choose **"Apply Comic Style (Halftone)"**,
and get a comic-stylized copy named `<name>_comic.mp4` written right next to the original.

It's a small, per-user Windows Explorer context-menu integration. No admin rights
required — it only touches your own user registry hive (`HKCU`).

## Exact-match renderer (what you see in the tuner is what you get)

The output now comes from an **offline renderer that runs the SAME WebGL pipeline
as the [Halftone tuner](index.html)** web app — the same shaders, pass order,
uniform values, and 1100&nbsp;px processing cap. So the MP4 is **pixel-faithful to
the tuner's on-screen preview** (deep warm sky, saturated colors popping, rich
inked lines).

This **replaces the old ffmpeg-only preset**, which used a different filter graph
(`edgedetect`/`lutyuv`/`bilateral`) and produced flatter, cooler tones than the
tuner preview. The renderer lives in [`renderer/`](renderer/):

- `renderer/renderer.html` — the WebGL pipeline (copied verbatim from the tuner).
- `renderer/render.js` — the driver: ffprobe → decode frames → run each frame
  through the WebGL pipeline in headless Chromium (via puppeteer) → encode an
  H.264 MP4, upscaled back to source resolution with `flags=lanczos`, original
  audio preserved.

It uses the tuner's **favorite defaults**: saturation 1.60, contrast 1.55,
flatten strength 6 / passes 2, color levels 12, ink threshold 0.80, thickness 1,
darkness 0.85, edges on. Override from the CLI, e.g.
`node renderer/render.js "clip.mp4" --sat 2.0 --lev 8 --no-edges`.

### One-time setup

The renderer needs its dependencies installed once (this downloads puppeteer's
bundled Chromium):

```
cd renderer
npm install
```

## What it does

You right-click `holiday.mp4` → **Apply Comic Style (Halftone)** → a moment later
`holiday_comic.mp4` appears in the same folder. That's it.

## Prerequisites

- **Windows** (10 or 11).
- **ffmpeg** installed and available on your `PATH`.
  - Download: <https://ffmpeg.org/download.html>
  - Or install with winget:
    ```
    winget install Gyan.FFmpeg
    ```
  - Verify it works by opening a terminal and running `ffmpeg -version`.
- **Node.js** installed and available on your `PATH` (the renderer runs on Node).
  - Download: <https://nodejs.org/>
  - Or install with winget:
    ```
    winget install OpenJS.NodeJS.LTS
    ```
  - Verify with `node -version`.
- **One-time** `cd renderer && npm install` (see above) — pulls puppeteer and its
  bundled Chromium into `renderer/node_modules` (not committed to this repo).

## Install

Clone or download this repo, then either:

- **Right-click `install.ps1` → Run with PowerShell**, or
- run in a terminal from the repo folder:
  ```
  powershell -ExecutionPolicy Bypass -File install.ps1
  ```

The installer registers the menu entry for these video extensions:
`.mp4 .mov .mkv .avi .webm .m4v`.

The context-menu command points at `apply-comic.ps1` using its absolute path
(resolved from where you cloned the repo), so **keep the repo folder where it is**
after installing. If you move it, re-run `install.ps1`. `apply-comic.ps1` in turn
runs `renderer/render.js`, so keep the `renderer/` folder (and its installed
`node_modules`) alongside it.

## Uninstall

- **Right-click `uninstall.ps1` → Run with PowerShell**, or
  ```
  powershell -ExecutionPolicy Bypass -File uninstall.ps1
  ```

This removes only the keys this tool created under `HKCU`.

## How it works (the pipeline)

`apply-comic.ps1` checks for `ffmpeg` and `node`, then runs `renderer/render.js`
on your video. The renderer reproduces the tuner's WebGL pipeline exactly:

1. **Probe** the input (`ffprobe`) for size, fps, and audio.
2. **Decode** frames with ffmpeg to a temp folder (outside the repo), scaled to the
   tuner's processing size — `min(1, 1100/width)` cap, `flags=lanczos` — so every
   pixel-relative parameter (bilateral radius, edge thickness, texel size) matches
   what you see in the preview.
3. **Stylize** each frame in headless Chromium through the exact WebGL passes:
   - **eq** — contrast then saturation (`(c-0.5)*con+0.5`, then mix toward luma by `sat`).
   - **bilateral ×passes** — edge-preserving flatten (radius `rad`, `sigmaR=0.14`,
     `sigmaS=max(rad*0.6,0.6)`), ping-ponged between framebuffers.
   - **composite** — YUV posterize to `levels` (luma floored to L bands, chroma
     centered-rounded so neutrals don't cast) + Sobel ink edges
     (`smoothstep(thr*4, …)`, thickness `thick`) multiplied in at darkness `op`.
4. **Read back** the processed pixels (flipped to top-down) and write PNGs.
5. **Encode** `libx264 -crf 18 -preset medium -pix_fmt yuv420p`, scaling **back up**
   to the source resolution with `flags=lanczos`, muxing the original audio through
   unchanged (`-c:a copy`), fps preserved.

Because the color math runs in the identical WebGL shaders, the MP4 matches the
tuner preview — not ffmpeg's approximation of it. Temp frames are deleted when done.

## Privacy

The tool runs **entirely locally** on your machine. Nothing is uploaded anywhere.
It only reads the video you pick and writes the `_comic.mp4` next to it.

## Scope / permissions

- **Per-user, no admin.** Installs and uninstalls modify only `HKCU`
  (`HKCU:\Software\Classes\SystemFileAssociations\<ext>\shell\HalftoneComic`).

## License

Source-visible. Copyright (c) 2026 aaron777collins. **All rights reserved.** See [LICENSE](LICENSE).
