# Installs a Haze app's release build for the current user on Windows. An
# app's [scripts.win32] install runs it after `haze build --release`, in the
# app's folder (where its haze.toml is):
#
#   install = 'haze build --release && powershell -NoProfile -ExecutionPolicy Bypass -File ../stdlib/app/install-windows.ps1 -Name quick-todo -DisplayName "Quick Todo"'
#
# The program goes where app.installedExecutable(Name) says it lives,
# %LOCALAPPDATA%\Programs\<Name>\<Name>.exe: that is the path a login entry
# names, so the two must agree. A Start menu entry named DisplayName starts it.
# With -Run the installed program is started afterwards (an app's
# [scripts.win32] install-run).
#
# A running app keeps its exe open, and Windows refuses to overwrite an open
# exe but lets it be renamed. So the installed exe is renamed aside and the new
# one put in its place; the running app carries on from the renamed file until
# it is quit, and the next install removes it.

param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$DisplayName,
    [string]$Source = (Join-Path (Get-Location) "__haze__\$Name\bin\$Name.exe"),
    [string]$Folder = (Join-Path $env:LOCALAPPDATA "Programs\$Name"),
    [string]$StartMenu = (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
    [switch]$Run
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "No release build at $Source"
}
New-Item -ItemType Directory -Force -Path $Folder | Out-Null
$target = Join-Path $Folder "$Name.exe"

# What earlier installs left: copies renamed aside (gone, unless one still
# runs) and copies that never made it into place.
foreach ($pattern in "$Name.old-*.exe", "$Name.new-*.exe") {
    Get-ChildItem -LiteralPath $Folder -Filter $pattern | ForEach-Object {
        try { Remove-Item -LiteralPath $_.FullName -Force } catch {}
    }
}

# Copied in beside it first, so that what follows is only renames within this
# folder: if one fails, the installed exe is put back as it was. A name of
# this install's own: one an earlier install left (or an antivirus still
# blocks after scanning it) can never stand in the way of this one.
$stamp = [DateTime]::Now.ToString("yyyyMMddHHmmss") + "-" + [Guid]::NewGuid().ToString("N").Substring(0, 6)
$incoming = Join-Path $Folder "$Name.new-$stamp.exe"
Copy-Item -LiteralPath $Source -Destination $incoming -Force

$running = $false
$aside = $null
if (Test-Path -LiteralPath $target) {
    $aside = Join-Path $Folder "$Name.old-$stamp.exe"
    Move-Item -LiteralPath $target -Destination $aside
}
try {
    Move-Item -LiteralPath $incoming -Destination $target
} catch {
    if ($aside) { Move-Item -LiteralPath $aside -Destination $target }
    # Nothing of this attempt stays behind (unless whatever refused the rename,
    # e.g. an antivirus scanning it, still holds it).
    try { Remove-Item -LiteralPath $incoming -Force } catch {}
    throw
}
if ($aside) {
    try { Remove-Item -LiteralPath $aside -Force } catch { $running = $true }
}

$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $StartMenu "$DisplayName.lnk"))
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $Folder
$shortcut.Save()

Write-Output "Installed $target"
if ($running) {
    # Not started: a single-instance app would only hand over to the old one.
    Write-Output "$DisplayName is running the previous version: quit it and start it again."
} elseif ($Run) {
    Start-Process -FilePath $target -WorkingDirectory $Folder
}
