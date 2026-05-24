param(
    [string]$ReleaseRoot
)

$ErrorActionPreference = "Stop"

$buildRelease = Join-Path $PSScriptRoot "build-release.ps1"

if ($ReleaseRoot) {
    & $buildRelease -ReleaseRoot $ReleaseRoot -SkipZip -StopRunningApp
}
else {
    & $buildRelease -SkipZip -StopRunningApp
}
