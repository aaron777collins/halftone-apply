<#
    uninstall.ps1 — Remove the "Apply Comic Style (Halftone)" Explorer
    context-menu entry for video files from HKCU.

    Run:  Right-click -> Run with PowerShell
      or  powershell -ExecutionPolicy Bypass -File uninstall.ps1
#>

$ErrorActionPreference = 'Stop'

$exts          = @('.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v')
$keyName       = 'HalftoneComic'
$folderKeyName = 'HalftoneComicFolder'

Write-Host 'Removing Halftone comic context-menu entries (HKCU)...'
Write-Host ''

$removed = 0
foreach ($ext in $exts) {
    $shellKey = "HKCU:\Software\Classes\SystemFileAssociations\$ext\shell\$keyName"
    if (Test-Path -Path $shellKey) {
        Remove-Item -Path $shellKey -Recurse -Force
        Write-Host "  removed    $ext"
        $removed++
    } else {
        Write-Host "  not found  $ext"
    }
}

# Per-folder verb.
$folderShellKey = "HKCU:\Software\Classes\Directory\shell\$folderKeyName"
if (Test-Path -Path $folderShellKey) {
    Remove-Item -Path $folderShellKey -Recurse -Force
    Write-Host '  removed    Directory (folder)'
    $removed++
} else {
    Write-Host '  not found  Directory (folder)'
}

Write-Host ''
if ($removed -gt 0) {
    Write-Host "Done. Removed $removed entr$(if ($removed -eq 1) {'y'} else {'ies'})." -ForegroundColor Green
} else {
    Write-Host 'Nothing to remove — no entries were found.' -ForegroundColor Yellow
}
