#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Lab 8 - publish the dotnet11lab CLI three ways and measure size, startup and memory (Windows counterpart of
    scripts/publish-compare.sh; also runs under PowerShell 7 on Linux/macOS).

.DESCRIPTION
    Modes (all Release, for the current RID, output in artifacts/publish/<mode>):
      framework-dependent  needs a .NET 11 runtime on the machine; smallest download.
      self-contained       runtime bundled; ONE single-file executable (PublishSingleFile=true), untrimmed.
      native-aot           PublishAot=true: ahead-of-time compiled native executable, no JIT.

    Writes results/publish/latest.json (read by the dashboard) and results/publish/latest.md.
    Native AOT on Windows needs Visual Studio 2022+ (or Build Tools) with the "Desktop development with C++"
    workload (MSVC linker + Windows SDK). There is no cross-OS Native AOT compilation.

.EXAMPLE
    pwsh ./scripts/publish-compare.ps1 -Runs 10
    pwsh ./scripts/publish-compare.ps1 -Modes fd,aot -Preliminary -Note "laptop on battery"
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 200)][int]$Runs = 10,
    [string[]]$Modes = @('framework-dependent', 'self-contained', 'native-aot'),
    [switch]$Preliminary,
    [string]$Note = '',
    [switch]$SkipPublish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$LabRoot = Split-Path -Parent $PSScriptRoot
Set-Location $LabRoot
$Project = 'src/DotNet11Lab.Cli/DotNet11Lab.Cli.csproj'
$PublishRoot = Join-Path 'artifacts' 'publish'
$ResultsDir = Join-Path 'results' 'publish'
$LogDir = Join-Path $PublishRoot 'logs'
New-Item -ItemType Directory -Force -Path $PublishRoot, $ResultsDir, $LogDir | Out-Null

# ---------- machine facts ----------
$arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
    'X64' { 'x64' } 'Arm64' { 'arm64' } default { throw "Unsupported architecture $_" }
}
if ($IsWindows -or $env:OS -eq 'Windows_NT') { $osFamily = 'win'; $exeName = 'dotnet11lab.exe' }
elseif ($IsMacOS) { $osFamily = 'osx'; $exeName = 'dotnet11lab' }
else { $osFamily = 'linux'; $exeName = 'dotnet11lab' }
$Rid = "$osFamily-$arch"
$OsDesc = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
$Cpu = 'unknown'
try {
    if ($osFamily -eq 'win') { $Cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim() }
    elseif ($osFamily -eq 'osx') { $Cpu = (sysctl -n machdep.cpu.brand_string) }
    else { $Cpu = ((Get-Content /proc/cpuinfo | Where-Object { $_ -like 'model name*' } | Select-Object -First 1) -split ':', 2)[1].Trim() }
} catch { }
$Cores = [Environment]::ProcessorCount
$Sdk = (dotnet --version).Trim()

function Get-PublishArgs([string]$mode) {
    switch ($mode) {
        'framework-dependent' { @('--self-contained', 'false', '-p:PublishSingleFile=false') }
        'self-contained' { @('--self-contained', 'true', '-p:PublishSingleFile=true') }
        'native-aot' { @('-p:PublishAot=true') }
    }
}

function Get-Stats([double[]]$values) {
    $sorted = $values | Sort-Object
    $n = $sorted.Count
    $median = if ($n % 2) { $sorted[($n - 1) / 2] } else { ($sorted[$n / 2 - 1] + $sorted[$n / 2]) / 2 }
    [ordered]@{ median = [math]::Round($median, 3); min = [math]::Round($sorted[0], 3); max = [math]::Round($sorted[-1], 3) }
}

$modeResults = @()
$mdRows = @()
foreach ($m in $Modes) {
    $mode = switch ($m) {
        { $_ -in 'fd', 'framework-dependent' } { 'framework-dependent' }
        { $_ -in 'sc', 'self-contained' } { 'self-contained' }
        { $_ -in 'aot', 'native-aot' } { 'native-aot' }
        default { throw "Unknown mode '$m' (use fd, sc, aot)" }
    }
    $out = Join-Path $PublishRoot $mode
    $pubArgs = Get-PublishArgs $mode
    $cmd = "dotnet publish $Project -c Release -r $Rid $($pubArgs -join ' ') -o $out"
    Write-Host "==> [$mode] $cmd"
    $ok = $true; $err = $null
    if (-not $SkipPublish) {
        if (Test-Path $out) { Remove-Item -Recurse -Force $out }
        $log = Join-Path $LogDir "$mode.log"
        & dotnet publish $Project -c Release -r $Rid @pubArgs -o $out *> $log
        if ($LASTEXITCODE -ne 0) {
            $ok = $false
            $err = 'dotnet publish failed: ' + ((Select-String -Path $log -Pattern 'error' | Select-Object -First 3 | ForEach-Object Line) -join ' ')
            Write-Warning "publish FAILED (see $log)"
        }
    }
    $exe = Join-Path $out $exeName
    if ($ok -and -not (Test-Path $exe)) { $ok = $false; $err = "executable $exe not found" }
    if (-not $ok) {
        $modeResults += [ordered]@{ mode = $mode; publishCommand = $cmd; succeeded = $false; error = $err }
        $mdRows += "| $mode | failed | | | | | |"
        continue
    }

    # Deployable files only: symbol files (*.pdb, *.dbg, *.dSYM) are not needed to run.
    $files = Get-ChildItem -Recurse -File $out | Where-Object { $_.Extension -notin '.pdb', '.dbg' -and $_.FullName -notmatch '\.dSYM' }
    $total = ($files | Measure-Object -Sum Length).Sum
    $exeSize = (Get-Item $exe).Length

    1..2 | ForEach-Object { & $exe --startup-probe | Out-Null }   # warm-up launches (disk cache)
    $walls = @(); $probes = @(); $peaks = @(); $last = $null
    for ($i = 0; $i -lt $Runs; $i++) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $line = & $exe --startup-probe
        $sw.Stop()
        $walls += $sw.Elapsed.TotalMilliseconds
        $probe = $line | ConvertFrom-Json
        if ($null -ne $probe.startToMainMs) { $probes += [double]$probe.startToMainMs }
        $peaks += [double]$probe.peakWorkingSetBytes
        $last = $probe
    }
    $wall = Get-Stats $walls
    $probeStats = if ($probes.Count) { Get-Stats $probes } else { $null }
    $peak = [long](Get-Stats $peaks).median

    Write-Host ("    size {0:N0} B ({1} files), exe {2:N0} B, startup median {3} ms, peak WS {4:N0} B" -f $total, $files.Count, $exeSize, $wall.median, $peak)
    $modeResults += [ordered]@{
        mode = $mode; publishCommand = $cmd; succeeded = $true
        totalSizeBytes = [long]$total; fileCount = $files.Count; executable = $exeName; executableSizeBytes = [long]$exeSize
        startupWallMs = $wall; startupProbeMs = $probeStats; peakWorkingSetBytes = $peak; maxRssBytes = $null
        isDynamicCodeSupported = [bool]$last.isDynamicCodeSupported; runtime = $last.runtime
    }
    $mdRows += ("| {0} | {1:N1} MB ({2} files) | {3:N1} MB | {4} ms | {5:N1} MB | | {6} |" -f $mode, ($total / 1MB), $files.Count, ($exeSize / 1MB), $wall.median, ($peak / 1MB), $last.isDynamicCodeSupported)
}

$generated = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
$noteText = if ($Note -and $Note -notmatch '[.!?]$') { "$Note." } else { $Note }
$fullNote = (($noteText, 'Timer: .NET Stopwatch in PowerShell (includes PowerShell process-launch overhead). Wall-clock includes process creation and teardown.') | Where-Object { $_ }) -join ' '
$result = [ordered]@{
    schemaVersion = 1
    generatedUtc = $generated
    preliminary = [bool]$Preliminary
    note = $fullNote
    machine = [ordered]@{ os = $OsDesc; processor = $Cpu; logicalCores = $Cores; rid = $Rid; sdk = $Sdk }
    settings = [ordered]@{ configuration = 'Release'; startupRuns = $Runs; selfContainedVariant = 'single-file, untrimmed' }
    modes = $modeResults
}
$json = $result | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $LabRoot (Join-Path $ResultsDir 'latest.json')), $json + "`n", [System.Text.UTF8Encoding]::new($false))

$md = @('# Publish comparison - dotnet11lab', '')
if ($Preliminary) { $md += '> **PRELIMINARY** - validation run (e.g. on a busy machine). Do not quote these numbers.', '' }
$md += "- Generated: $generated · RID ``$Rid`` · SDK $Sdk · $Runs startup runs per mode"
$md += "- Machine: $Cpu, $Cores logical cores, $OsDesc"
$md += "- $fullNote", ''
$md += '| Mode | Deployed size | Executable | Startup (median wall) | Peak working set | Max RSS | Dynamic code |'
$md += '|---|---:|---:|---:|---:|---:|---|'
$md += $mdRows
[System.IO.File]::WriteAllText((Join-Path $LabRoot (Join-Path $ResultsDir 'latest.md')), ($md -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $ResultsDir/latest.json and $ResultsDir/latest.md"
