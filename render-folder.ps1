<#
    render-folder.ps1 — Halftone batch worker (EXACT-match renderer).

    Comic-styles EVERY video in a folder through the SAME WebGL pipeline as the
    "Halftone" tuner web app (renderer/render.js + renderer/renderer.html), so
    the output is pixel-faithful to the tuner's on-screen preview — not ffmpeg's
    approximation of it. Runs entirely locally.

    Usage:
      Right-click a FOLDER -> "Comic-style all videos in folder (Halftone)", or
      powershell -NoProfile -ExecutionPolicy Bypass -File render-folder.ps1 "C:\clips" ["C:\out"]

    - $args[0]  input folder (if omitted: folder-picker, else current directory)
    - $args[1]  output folder (optional; default = <input>\output)
#>

$ErrorActionPreference = 'Stop'

function Pause-Exit([int]$code) {
    Read-Host 'Done — press Enter to close' | Out-Null
    exit $code
}

# --- Resolve the input folder ----------------------------------------------
$inDir = $args[0]
if ([string]::IsNullOrWhiteSpace($inDir)) {
    # No argument: try a graphical folder-picker; fall back to current dir.
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = 'Pick a folder of videos to comic-style (Halftone)'
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $inDir = $dlg.SelectedPath
        }
    } catch { }
    if ([string]::IsNullOrWhiteSpace($inDir)) { $inDir = (Get-Location).Path }
}

if (-not (Test-Path -LiteralPath $inDir -PathType Container)) {
    Write-Host "ERROR: Input folder not found: $inDir" -ForegroundColor Red
    Pause-Exit 1
}
$inDir = (Resolve-Path -LiteralPath $inDir).Path

# --- Optional output folder -------------------------------------------------
$outDir = $args[1]

# --- Validate node ----------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'ERROR: Node.js (node) was not found on your PATH.' -ForegroundColor Red
    Write-Host 'The exact-match renderer runs on Node.js. Install it, then try again.'
    Write-Host '  - Download:  https://nodejs.org/'
    Write-Host '  - Or run:    winget install OpenJS.NodeJS.LTS'
    Pause-Exit 1
}

# --- Validate ffmpeg --------------------------------------------------------
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host 'ERROR: ffmpeg was not found on your PATH.' -ForegroundColor Red
    Write-Host '  - Download:  https://ffmpeg.org/download.html'
    Write-Host '  - Or run:    winget install Gyan.FFmpeg'
    Pause-Exit 1
}

# --- Locate the renderer + its dependencies ---------------------------------
$renderer = Join-Path $PSScriptRoot 'renderer\render.js'
if (-not (Test-Path -LiteralPath $renderer -PathType Leaf)) {
    Write-Host "ERROR: Could not find the renderer at $renderer" -ForegroundColor Red
    Pause-Exit 1
}
$puppeteer = Join-Path $PSScriptRoot 'renderer\node_modules\puppeteer'
if (-not (Test-Path -LiteralPath $puppeteer -PathType Container)) {
    Write-Host 'ERROR: The renderer''s dependencies are not installed yet.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Run this one-time setup in a terminal:'
    Write-Host ('    cd "' + (Join-Path $PSScriptRoot 'renderer') + '"')
    Write-Host '    npm install'
    Pause-Exit 1
}

Write-Host "Input folder:  $inDir"
if (-not [string]::IsNullOrWhiteSpace($outDir)) { Write-Host "Output folder: $outDir" }
Write-Host 'Comic-styling all videos (exact tuner match)... (this can take a while)'
Write-Host ''

# --- Run the exact-match renderer over the folder ---------------------------
if ([string]::IsNullOrWhiteSpace($outDir)) {
    & node $renderer $inDir
} else {
    & node $renderer $inDir '--out' $outDir
}
$code = $LASTEXITCODE

Write-Host ''
if ($code -ne 0) {
    Write-Host "ERROR: renderer exited with code $code. Some or all files may not have been written." -ForegroundColor Red
    Pause-Exit $code
}

Write-Host 'SUCCESS!' -ForegroundColor Green
if ([string]::IsNullOrWhiteSpace($outDir)) {
    Write-Host ("Outputs written to: " + (Join-Path $inDir 'output'))
} else {
    Write-Host "Outputs written to: $outDir"
}
Pause-Exit 0
