# Halftone — Right-click "Apply Comic Style" for Windows

Right-click any video file in Windows Explorer, choose **"Apply Comic Style (Halftone)"**,
and get a comic-stylized copy named `<name>_comic.mp4` written right next to the original.

It's a small, per-user Windows Explorer context-menu integration that runs a fixed
[ffmpeg](https://ffmpeg.org/) filter pipeline (the "Halftone" preset). No admin rights
required — it only touches your own user registry hive (`HKCU`).

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
after installing. If you move it, re-run `install.ps1`.

## Uninstall

- **Right-click `uninstall.ps1` → Run with PowerShell**, or
  ```
  powershell -ExecutionPolicy Bypass -File uninstall.ps1
  ```

This removes only the keys this tool created under `HKCU`.

## How it works (the pipeline)

`apply-comic.ps1` runs the following ffmpeg command (only the input/output paths change):

```
ffmpeg -y -i "input.mp4" -filter_complex "[0:v]scale=iw*2:ih*2:flags=lanczos,eq=saturation=2.60:contrast=1.35,bilateral=sigmaS=30:sigmaR=0.1,bilateral=sigmaS=30:sigmaR=0.1,split[f1][f2];[f1]lutyuv=y='floor(val/51)*51':u='round((val-128)/51)*51+128':v='round((val-128)/51)*51+128'[base];[f2]edgedetect=low=0.40:high=0.93,negate,erosion,format=yuv420p[edges];[base][edges]blend=all_mode=multiply:c0_opacity=0.85:c1_opacity=0:c2_opacity=0,scale=iw/2:ih/2:flags=lanczos[out]" -map "[out]" -map 0:a? -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy "input_comic.mp4"
```

Stage by stage:

1. **Upscale 2×** (`scale ... lanczos`) so the following filters have more detail to work with.
2. **Punch up color** (`eq=saturation=2.60:contrast=1.35`) for a bold, printed look.
3. **Bilateral smoothing ×2** (`bilateral`) to flatten noise and shading while keeping edges — the "cel" look.
4. **Split** the stream into two copies.
5. **Posterize** one copy (`lutyuv` with `floor`/`round` on Y/U/V) to quantize luma and chroma into flat bands — the halftone/comic fill.
6. **Extract ink lines** from the other copy: `edgedetect` → `negate` → `erosion` → black outlines on white.
7. **Multiply-blend** the outlines over the posterized fill so the lines darken the art like inked linework.
8. **Downscale back** to the original resolution and encode with `libx264 -crf 18`. Audio is copied through unchanged (`-c:a copy`).

## Privacy

The tool runs **entirely locally** on your machine. Nothing is uploaded anywhere.
It only reads the video you pick and writes the `_comic.mp4` next to it.

## Scope / permissions

- **Per-user, no admin.** Installs and uninstalls modify only `HKCU`
  (`HKCU:\Software\Classes\SystemFileAssociations\<ext>\shell\HalftoneComic`).

## License

Source-visible. Copyright (c) 2026 aaron777collins. **All rights reserved.** See [LICENSE](LICENSE).
