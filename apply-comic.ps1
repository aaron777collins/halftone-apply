<#
    apply-comic.ps1 — Halftone comic-stylization worker (EXACT-match renderer).

    Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File apply-comic.ps1 "C:\path\to\video.mp4"

    Runs the video through the SAME WebGL pipeline as the "Halftone" tuner web app
    (renderer/render.js + renderer/renderer.html) and writes "<name>_comic.mp4"
    next to the original. The output look is pixel-faithful to the tuner's
    on-screen preview — this replaces the older ffmpeg-only approximation, which
    produced flatter/cooler tones than the tuner. Runs entirely locally.
#>

$ErrorActionPreference = 'Stop'

function Pause-Exit([int]$code) {
    Read-Host 'Done — press Enter to close' | Out-Null
    exit $code
}

# --- Validate input argument ------------------------------------------------
$in = $args[0]
if ([string]::IsNullOrWhiteSpace($in)) {
    Write-Host 'ERROR: No input file provided.' -ForegroundColor Red
    Write-Host 'Usage: apply-comic.ps1 "C:\path\to\video.mp4"'
    Pause-Exit 1
}

if (-not (Test-Path -LiteralPath $in -PathType Leaf)) {
    Write-Host "ERROR: Input file not found: $in" -ForegroundColor Red
    Pause-Exit 1
}

# --- Validate ffmpeg is available -------------------------------------------
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host 'ERROR: ffmpeg was not found on your PATH.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Please install ffmpeg and make sure it is on your PATH, then try again.'
    Write-Host '  - Download:  https://ffmpeg.org/download.html'
    Write-Host '  - Or run:    winget install Gyan.FFmpeg'
    Pause-Exit 1
}

# --- Validate node is available ---------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'ERROR: Node.js (node) was not found on your PATH.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'The exact-match renderer runs on Node.js. Please install it, then try again.'
    Write-Host '  - Download:  https://nodejs.org/'
    Write-Host '  - Or run:    winget install OpenJS.NodeJS.LTS'
    Pause-Exit 1
}

# --- Locate the renderer ----------------------------------------------------
$renderer = Join-Path $PSScriptRoot 'renderer\render.js'
if (-not (Test-Path -LiteralPath $renderer -PathType Leaf)) {
    Write-Host "ERROR: Could not find the renderer at $renderer" -ForegroundColor Red
    Pause-Exit 1
}

# One-time dependency check: node_modules must exist (from `npm install`).
$nodeModules = Join-Path $PSScriptRoot 'renderer\node_modules\puppeteer'
if (-not (Test-Path -LiteralPath $nodeModules -PathType Container)) {
    Write-Host 'ERROR: The renderer''s dependencies are not installed yet.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Run this one-time setup in a terminal:'
    Write-Host ('    cd "' + (Join-Path $PSScriptRoot 'renderer') + '"')
    Write-Host '    npm install'
    Pause-Exit 1
}

$item = Get-Item -LiteralPath $in
Write-Host "Input:  $($item.FullName)"
Write-Host 'Applying Halftone comic style (exact tuner match)... (this can take a while)'
Write-Host ''

# --- Run the exact-match renderer -------------------------------------------
& node $renderer $item.FullName
$code = $LASTEXITCODE

Write-Host ''
if ($code -ne 0) {
    Write-Host "ERROR: renderer exited with code $code. The output may be incomplete." -ForegroundColor Red
    Pause-Exit $code
}

$base = [System.IO.Path]::GetFileNameWithoutExtension($item.Name)
$out  = Join-Path $item.DirectoryName ($base + '_comic.mp4')
if (-not (Test-Path -LiteralPath $out -PathType Leaf)) {
    Write-Host 'ERROR: renderer reported success but the output file was not created.' -ForegroundColor Red
    Pause-Exit 1
}

Write-Host 'SUCCESS!' -ForegroundColor Green
Write-Host "Wrote: $out"
Pause-Exit 0
