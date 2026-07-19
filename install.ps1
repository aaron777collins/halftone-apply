<#
    install.ps1 — Register the Halftone Explorer context-menu entries under
    HKCU (per-user, no admin required):
      * a per-FILE verb  "Apply Comic Style (Halftone)"  on video files, and
      * a per-FOLDER verb "Comic-style all videos in folder (Halftone)" that
        batch-renders every video in the folder.

    Run:  Right-click -> Run with PowerShell
      or  powershell -ExecutionPolicy Bypass -File install.ps1
#>

$ErrorActionPreference = 'Stop'

$exts          = @('.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v')
$label         = 'Apply Comic Style (Halftone)'
$keyName       = 'HalftoneComic'
$folderLabel   = 'Comic-style all videos in folder (Halftone)'
$folderKeyName = 'HalftoneComicFolder'

# Absolute paths to the workers, resolved relative to THIS installer's location,
# so they work wherever the repo is cloned.
$worker = Join-Path $PSScriptRoot 'apply-comic.ps1'
if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) {
    Write-Host "ERROR: Could not find apply-comic.ps1 next to this installer ($worker)." -ForegroundColor Red
    exit 1
}
$worker = (Resolve-Path -LiteralPath $worker).Path

$folderWorker = Join-Path $PSScriptRoot 'render-folder.ps1'
if (-not (Test-Path -LiteralPath $folderWorker -PathType Leaf)) {
    Write-Host "ERROR: Could not find render-folder.ps1 next to this installer ($folderWorker)." -ForegroundColor Red
    exit 1
}
$folderWorker = (Resolve-Path -LiteralPath $folderWorker).Path

# Icon: use powershell.exe's icon (harmless if unavailable).
$icon = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

# %1 = the clicked file; %V = the clicked/open folder path.
$command       = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$worker`" `"%1`""
$folderCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$folderWorker`" `"%V`""

# --- Per-file verbs ---------------------------------------------------------
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

# --- Per-folder verb --------------------------------------------------------
Write-Host ''
Write-Host "Registering '$folderLabel' for folders (per-user, HKCU)..."
Write-Host "Worker: $folderWorker"

$folderShellKey = "HKCU:\Software\Classes\Directory\shell\$folderKeyName"
$folderCmdKey   = "$folderShellKey\command"

New-Item -Path $folderCmdKey -Force | Out-Null
Set-ItemProperty -Path $folderShellKey -Name '(Default)' -Value $folderLabel
Set-ItemProperty -Path $folderShellKey -Name 'Icon'      -Value $icon
Set-ItemProperty -Path $folderCmdKey   -Name '(Default)' -Value $folderCommand
Write-Host '  registered  Directory'

Write-Host ''
Write-Host 'Done. Right-click a video file and choose:' -ForegroundColor Green
Write-Host "    $label"
Write-Host 'or right-click a folder and choose:' -ForegroundColor Green
Write-Host "    $folderLabel"
Write-Host ''
Write-Host 'If the entry does not appear immediately, restart Explorer or sign out/in.'
