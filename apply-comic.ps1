<#
    apply-comic.ps1 — Halftone comic-stylization worker.

    Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File apply-comic.ps1 "C:\path\to\video.mp4"

    Applies the Halftone comic-stylization ffmpeg preset to the input video and
    writes "<name>_comic.mp4" next to the original. Runs entirely locally.
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

# --- Compute output path ----------------------------------------------------
$item    = Get-Item -LiteralPath $in
$dir     = $item.DirectoryName
$base    = [System.IO.Path]::GetFileNameWithoutExtension($item.Name)
$out     = Join-Path $dir ($base + '_comic.mp4')

Write-Host "Input:  $($item.FullName)"
Write-Host "Output: $out"
Write-Host ''
Write-Host 'Applying Halftone comic style... (this can take a while)'
Write-Host ''

# --- The exact Halftone preset ----------------------------------------------
# $graph is the -filter_complex VALUE only (no surrounding quotes). It is passed
# to ffmpeg as a SINGLE argv element via the argument array below, so the single
# quotes and commas inside it are preserved literally.
$graph = "[0:v]scale=iw*2:ih*2:flags=lanczos,eq=saturation=2.60:contrast=1.35,bilateral=sigmaS=30:sigmaR=0.1,bilateral=sigmaS=30:sigmaR=0.1,split[f1][f2];[f1]lutyuv=y='floor(val/51)*51':u='round((val-128)/51)*51+128':v='round((val-128)/51)*51+128'[base];[f2]edgedetect=low=0.40:high=0.93,negate,erosion,format=yuv420p[edges];[base][edges]blend=all_mode=multiply:c0_opacity=0.85:c1_opacity=0:c2_opacity=0,scale=iw/2:ih/2:flags=lanczos[out]"

$ffArgs = @(
    '-y',
    '-i', $item.FullName,
    '-filter_complex', $graph,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    $out
)

& ffmpeg @ffArgs
$code = $LASTEXITCODE

Write-Host ''
if ($code -ne 0) {
    Write-Host "ERROR: ffmpeg exited with code $code. The output may be incomplete." -ForegroundColor Red
    Pause-Exit $code
}

if (-not (Test-Path -LiteralPath $out -PathType Leaf)) {
    Write-Host 'ERROR: ffmpeg reported success but the output file was not created.' -ForegroundColor Red
    Pause-Exit 1
}

Write-Host 'SUCCESS!' -ForegroundColor Green
Write-Host "Wrote: $out"
Pause-Exit 0
