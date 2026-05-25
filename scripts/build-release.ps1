param(
    [string]$ReleaseRoot,
    [switch]$SkipZip,
    [switch]$StopRunningApp
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WebRoot = Join-Path $ProjectRoot "web"
$NativeRoot = Join-Path $ProjectRoot "native"
$Package = Get-Content -LiteralPath (Join-Path $WebRoot "package.json") -Raw | ConvertFrom-Json
$Version = if ($Package.version) { [string]$Package.version } else { "0.1.0" }

if (-not $ReleaseRoot) {
    $ReleaseRoot = Join-Path $ProjectRoot "release"
}

$ReleaseRoot = [System.IO.Path]::GetFullPath($ReleaseRoot)
$AppDir = Join-Path $ReleaseRoot "AniListManagerPortable"
$ZipPath = Join-Path $ReleaseRoot "AniListManagerPortable-$Version-win-x64.zip"
$PublishDir = Join-Path $ReleaseRoot ".publish"
$PreserveDir = Join-Path $ReleaseRoot ".preserve"
$BuildRoot = Join-Path ([System.IO.Path]::GetPathRoot($ProjectRoot)) "AniListManagerPortableBuild"
$BuildNative = Join-Path $BuildRoot "native"

function Assert-ChildPath {
    param([string]$Parent, [string]$Child)
    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $childFull = [System.IO.Path]::GetFullPath($Child)
    if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside expected folder: $childFull"
    }
}

function Reset-Directory {
    param([string]$Path)
    Assert-ChildPath -Parent $ReleaseRoot -Child $Path
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Reset-BuildRoot {
    $expected = Join-Path ([System.IO.Path]::GetPathRoot($ProjectRoot)) "AniListManagerPortableBuild"
    $fullPath = [System.IO.Path]::GetFullPath($BuildRoot)
    if (-not $fullPath.Equals([System.IO.Path]::GetFullPath($expected), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to reset unexpected build folder: $fullPath"
    }
    if (Test-Path -LiteralPath $fullPath) {
        Remove-Item -LiteralPath $fullPath -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $BuildNative | Out-Null
}

function Copy-DirectoryMirror {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        return $false
    }

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    robocopy $Source $Destination /MIR /COPY:DAT /DCOPY:DAT /R:3 /W:1 /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Failed to copy $Label folder from $Source to $Destination. Robocopy exit code: $LASTEXITCODE"
    }

    $files = @(Get-ChildItem -LiteralPath $Destination -Recurse -Force -File -ErrorAction SilentlyContinue)
    $fileCount = $files.Count
    $byteCount = ($files | Measure-Object -Property Length -Sum).Sum
    if ($null -eq $byteCount) {
        $byteCount = 0
    }
    [pscustomobject]@{
        Copied = $true
        Label = $Label
        FileCount = $fileCount
        ByteCount = $byteCount
    }
}

function Backup-RuntimeFolders {
    Assert-ChildPath -Parent $ReleaseRoot -Child $PreserveDir
    if (Test-Path -LiteralPath $PreserveDir) {
        Remove-Item -LiteralPath $PreserveDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $PreserveDir | Out-Null

    foreach ($name in @("data", ".runtime")) {
        $source = Join-Path $AppDir $name
        $destination = Join-Path $PreserveDir $name
        $copyResult = Copy-DirectoryMirror -Source $source -Destination $destination -Label "Backed up $name"
        if ($copyResult.Copied) {
            Write-Output "$($copyResult.Label) folder mirror complete: $($copyResult.FileCount) files, $($copyResult.ByteCount) bytes."
            Write-Output "Backed up $name folder."
        }
    }
}

function Restore-RuntimeFolders {
    if (-not (Test-Path -LiteralPath $PreserveDir)) {
        return
    }

    foreach ($name in @("data", ".runtime")) {
        $source = Join-Path $PreserveDir $name
        if (Test-Path -LiteralPath $source) {
            $target = Join-Path $AppDir $name
            if (Test-Path -LiteralPath $target) {
                Remove-Item -LiteralPath $target -Recurse -Force
            }
            $copyResult = Copy-DirectoryMirror -Source $source -Destination $target -Label "Restored $name"
            Write-Output "$($copyResult.Label) folder mirror complete: $($copyResult.FileCount) files, $($copyResult.ByteCount) bytes."
            Write-Output "Restored $name folder."
        }
    }

    Remove-Item -LiteralPath $PreserveDir -Recurse -Force
}

function Content-TypeFor {
    param([string]$Path)
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8"; break }
        ".js" { "text/javascript; charset=utf-8"; break }
        ".css" { "text/css; charset=utf-8"; break }
        ".json" { "application/json; charset=utf-8"; break }
        ".svg" { "image/svg+xml"; break }
        ".png" { "image/png"; break }
        ".jpg" { "image/jpeg"; break }
        ".jpeg" { "image/jpeg"; break }
        ".webp" { "image/webp"; break }
        ".ico" { "image/x-icon"; break }
        default { "application/octet-stream" }
    }
}

function CsString {
    param([string]$Value)
    return $Value.Replace("\", "\\").Replace('"', '\"')
}

function Base64Expression {
    param([string]$Base64)
    $chunks = [System.Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $Base64.Length; $index += 120) {
        $length = [Math]::Min(120, $Base64.Length - $index)
        $chunks.Add('"' + $Base64.Substring($index, $length) + '"')
    }
    return "string.Concat($($chunks -join ', '))"
}

function Generate-WebAssets {
    $dist = Join-Path $WebRoot "dist"
    $output = Join-Path $NativeRoot "Generated\WebAssets.g.cs"
    if (-not (Test-Path -LiteralPath (Join-Path $dist "index.html"))) {
        throw "Web dist is missing index.html."
    }

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("namespace AniListManagerPortable.Generated;")
    $lines.Add("")
    $lines.Add("internal sealed record WebAsset(string ContentType, byte[] Bytes);")
    $lines.Add("")
    $lines.Add("internal static class WebAssets")
    $lines.Add("{")
    $lines.Add("    public static readonly IReadOnlyDictionary<string, WebAsset> Assets =")
    $lines.Add("        new Dictionary<string, WebAsset>(StringComparer.OrdinalIgnoreCase)")
    $lines.Add("        {")

    $distUri = [Uri]((Resolve-Path -LiteralPath $dist).Path.TrimEnd('\') + '\')
    foreach ($file in Get-ChildItem -LiteralPath $dist -Recurse -File | Sort-Object FullName) {
        $relative = [Uri]::UnescapeDataString($distUri.MakeRelativeUri([Uri]$file.FullName).ToString())
        $contentType = Content-TypeFor $file.FullName
        $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($file.FullName))
        $lines.Add("            [`"$(CsString $relative)`"] = new(`"$(CsString $contentType)`", Convert.FromBase64String($(Base64Expression $base64))),")
    }

    $lines.Add("        };")
    $lines.Add("}")
    Set-Content -LiteralPath $output -Value $lines -Encoding UTF8
}

function Assert-NoForbiddenText {
    param([string]$Path)
    $forbiddenPatterns = [System.Collections.Generic.List[string]]::new()
    foreach ($pattern in @($ProjectRoot, $BuildRoot, ".nuget", "node_modules", "node.exe")) {
        if (-not [string]::IsNullOrWhiteSpace($pattern)) {
            $forbiddenPatterns.Add($pattern)
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:USERNAME)) {
        $forbiddenPatterns.Add($env:USERNAME)
    }

    foreach ($pattern in $forbiddenPatterns) {
        if (Select-String -LiteralPath $Path -SimpleMatch -Pattern $pattern -Quiet -ErrorAction SilentlyContinue) {
            throw "Release contains forbidden text '$pattern' in $Path"
        }
    }
}

function Stop-PortableApp {
    $processes = Get-Process -Name "AniListManagerPortable" -ErrorAction SilentlyContinue
    if (-not $processes) {
        return
    }

    foreach ($process in $processes) {
        Stop-Process -Id $process.Id -Force
        Write-Output "Stopped AniListManagerPortable process $($process.Id)."
    }
}

function Stop-WorkspaceFrontendProcesses {
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'esbuild.exe'" |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.Contains($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)
        }

    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output "Stopped workspace frontend process $($process.Name) $($process.ProcessId)."
    }
}

function Find-VsDevCmd {
    $candidates = @()
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $vswhere) {
        $installPaths = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        foreach ($installPath in $installPaths) {
            if ($installPath) {
                $candidates += Join-Path $installPath "Common7\Tools\VsDevCmd.bat"
            }
        }
    }

    $candidates += @(
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\18\Professional\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\18\Enterprise\Common7\Tools\VsDevCmd.bat"
    )

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Import-VsDevEnvironment {
    if (Get-Command link.exe -ErrorAction SilentlyContinue) {
        return $true
    }

    $vsDevCmd = Find-VsDevCmd
    if (-not $vsDevCmd) {
        return $false
    }

    Write-Output "Loading MSVC build environment from $vsDevCmd"
    $environmentLines = & "$env:ComSpec" /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to load MSVC build environment from $vsDevCmd."
    }

    foreach ($line in $environmentLines) {
        $equalsIndex = $line.IndexOf("=")
        if ($equalsIndex -le 0) {
            continue
        }
        $name = $line.Substring(0, $equalsIndex)
        $value = $line.Substring($equalsIndex + 1)
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }

    return [bool](Get-Command link.exe -ErrorAction SilentlyContinue)
}

function Invoke-WebBuild {
    Push-Location $WebRoot
    try {
        npm ci
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "npm ci failed. Stopping workspace frontend processes and retrying once."
            Stop-WorkspaceFrontendProcesses
            npm ci
            if ($LASTEXITCODE -ne 0) {
                throw "npm ci failed with exit code $LASTEXITCODE."
            }
        }

        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

try {
    New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
    if ($StopRunningApp) {
        Stop-PortableApp
    }
    Backup-RuntimeFolders
    Reset-Directory $AppDir
    Reset-Directory $PublishDir
    Reset-BuildRoot

    Write-Output "Building React UI..."
    Invoke-WebBuild

    Write-Output "Embedding web assets..."
    Generate-WebAssets

    Write-Output "Publishing native executable..."
    Get-ChildItem -LiteralPath $NativeRoot -Force | Copy-Item -Destination $BuildNative -Recurse -Force
    $projectPath = Join-Path $BuildNative "AniListManagerPortable.csproj"
    $aotSucceeded = $false
    if (Import-VsDevEnvironment) {
        dotnet publish $projectPath `
            -c Release `
            -r win-x64 `
            --self-contained true `
            -p:PublishAot=true `
            -p:DebugType=None `
            -p:DebugSymbols=false `
            -p:StripSymbols=true `
            -p:IlcOptimizationPreference=Size `
            -o $PublishDir
        $aotSucceeded = $LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath (Join-Path $PublishDir "AniListManagerPortable.exe"))
        if (-not $aotSucceeded) {
            Write-Warning "Native AOT publish failed. Falling back to trimmed self-contained single-file publish."
        }
    }
    else {
        Write-Warning "MSVC link.exe is unavailable. Install Visual Studio Build Tools with the Desktop development with C++ workload to publish Native AOT. Falling back to trimmed self-contained single-file publish."
    }

    if (-not $aotSucceeded) {
        Reset-Directory $PublishDir
        dotnet publish $projectPath `
        -c Release `
        -r win-x64 `
        --self-contained true `
        -p:PublishAot=false `
        -p:PublishSingleFile=true `
        -p:PublishTrimmed=true `
        -p:EnableCompressionInSingleFile=true `
        -p:DebugType=None `
        -p:DebugSymbols=false `
        -p:TrimMode=partial `
        -o $PublishDir
    }

    Copy-Item -LiteralPath (Join-Path $PublishDir "AniListManagerPortable.exe") -Destination (Join-Path $AppDir "AniListManagerPortable.exe") -Force
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "README.md") -Destination (Join-Path $AppDir "README.md") -Force

    foreach ($file in Get-ChildItem -LiteralPath $AppDir -Recurse -File) {
        Assert-NoForbiddenText $file.FullName
    }

    if (-not $SkipZip) {
        if (Test-Path -LiteralPath $ZipPath) {
            Remove-Item -LiteralPath $ZipPath -Force
        }

        Compress-Archive -LiteralPath $AppDir -DestinationPath $ZipPath -Force
    }

    Restore-RuntimeFolders

    Remove-Item -LiteralPath $PublishDir -Recurse -Force
    if (Test-Path -LiteralPath $BuildRoot) {
        Remove-Item -LiteralPath $BuildRoot -Recurse -Force
    }

    if ($SkipZip) {
        Write-Output "Portable release test folder rebuilt without ZIP packaging: $AppDir"
    }
    else {
        $zipSizeMb = [math]::Round((Get-Item -LiteralPath $ZipPath).Length / 1MB, 2)
        Write-Output "Portable native release created: $ZipPath"
        Write-Output "ZIP size: $zipSizeMb MB"
        if ($zipSizeMb -gt 40) {
            Write-Warning "Release exceeds 40 MB; investigate native publish size."
        }
    }
}
finally {
    Restore-RuntimeFolders
}
