<#
    install.ps1 — Register the "Apply Comic Style (Halftone)" Explorer
    context-menu entry for video files under HKCU (per-user, no admin required).

    Run:  Right-click -> Run with PowerShell
      or  powershell -ExecutionPolicy Bypass -File install.ps1
#>

$ErrorActionPreference = 'Stop'

$exts    = @('.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v')
$label   = 'Apply Comic Style (Halftone)'
$keyName = 'HalftoneComic'

# Absolute path to the worker, resolved relative to THIS installer's location,
# so it works wherever the repo is cloned.
$worker = Join-Path $PSScriptRoot 'apply-comic.ps1'
if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) {
    Write-Host "ERROR: Could not find apply-comic.ps1 next to this installer ($worker)." -ForegroundColor Red
    exit 1
}
$worker = (Resolve-Path -LiteralPath $worker).Path

# Icon: use powershell.exe's icon (harmless if unavailable).
$icon = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$worker`" `"%1`""

Write-Host "Registering '$label' for video files (per-user, HKCU)..."
Write-Host "Worker: $worker"
Write-Host ''

foreach ($ext in $exts) {
    $shellKey = "HKCU:\Software\Classes\SystemFileAssociations\$ext\shell\$keyName"
    $cmdKey   = "$shellKey\command"

    New-Item -Path $cmdKey -Force | Out-Null

    Set-ItemProperty -Path $shellKey -Name '(Default)' -Value $label
    Set-ItemProperty -Path $shellKey -Name 'Icon'      -Value $icon
    Set-ItemProperty -Path $cmdKey   -Name '(Default)' -Value $command

    Write-Host "  registered  $ext"
}

Write-Host ''
Write-Host 'Done. Right-click a video file and choose:' -ForegroundColor Green
Write-Host "    $label"
Write-Host ''
Write-Host 'If the entry does not appear immediately, restart Explorer or sign out/in.'
