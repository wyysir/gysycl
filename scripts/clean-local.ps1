param([switch]$Apply)

# Default: preview. Only reproducible build/cache paths are eligible.
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$rootPrefix = $projectRoot + '\'

function Assert-LocalPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes project: $full"
    }
    return $full
}

function Test-Link($Item) {
    return ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

function Find-Builds([string]$Directory) {
    foreach ($item in Get-ChildItem -LiteralPath $Directory -Force -Directory) {
        if (Test-Link $item) { continue }
        if ($item.Name -in @('.next', '.next-ledger')) { $item.FullName; continue }
        if ($item.Name -in @('.git', 'node_modules', '.data', 'pw-browsers')) { continue }
        Find-Builds $item.FullName
    }
}

function Measure-LocalTree([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (Test-Link $item) { return 0L }
    if (-not $item.PSIsContainer) { return [long]$item.Length }
    $bytes = 0L
    foreach ($child in Get-ChildItem -LiteralPath $Path -Force) {
        $bytes += Measure-LocalTree $child.FullName
    }
    return $bytes
}

function Remove-LocalTree([string]$Path) {
    $full = Assert-LocalPath $Path
    $item = Get-Item -LiteralPath $full -Force
    # Remove junctions themselves; never enumerate their targets.
    if ((Test-Link $item) -or -not $item.PSIsContainer) {
        Remove-Item -LiteralPath $full -Force
        return
    }
    foreach ($child in Get-ChildItem -LiteralPath $full -Force) {
        Remove-LocalTree $child.FullName
    }
    Remove-Item -LiteralPath $full -Force
}

$candidates = @(
    foreach ($name in @('.next', '.npm-cache', 'tsconfig.tsbuildinfo')) {
        $path = Join-Path $projectRoot $name
        if (Test-Path -LiteralPath $path) { $path }
    }
    $tempRoot = Join-Path $projectRoot '.tmp'
    if ((Test-Path -LiteralPath $tempRoot) -and -not (Test-Link (Get-Item -LiteralPath $tempRoot -Force))) {
        Find-Builds $tempRoot
    }
)

$plan = @(
    foreach ($path in $candidates | Sort-Object -Unique) {
        $full = Assert-LocalPath $path
        # Check all ancestors before measuring or removing a candidate.
        $ancestor = $full
        while ($ancestor -ne $projectRoot) {
            if (Test-Link (Get-Item -LiteralPath $ancestor -Force)) { throw "Linked path refused: $ancestor" }
            $ancestor = [IO.Path]::GetDirectoryName($ancestor)
        }
        [pscustomobject]@{ path = $full.Substring($rootPrefix.Length).Replace('\', '/'); bytes = Measure-LocalTree $full }
    }
)

$total = ($plan | Measure-Object -Property bytes -Sum).Sum
$plan | Select-Object path, @{Name='MiB'; Expression={[math]::Round($_.bytes / 1MB, 2)}} | Format-Table -AutoSize
Write-Host ("{0} targets; {1:N2} MiB; apply={2}" -f $plan.Count, ($total / 1MB), [bool]$Apply)
if (-not $Apply) { return }

# Fail closed if process inspection is unavailable. Do not stop other sessions.
$running = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -match 'next[\\/]dist[\\/]bin[\\/]next|next-server|npm-cli\.js.*(dev|build|start|install|ci)'
})
if ($running.Count) { throw 'A Next.js/npm process is active. Stop it before cleaning.' }

$reportDirectory = Join-Path $projectRoot '.data\maintenance'
$dataDirectory = Join-Path $projectRoot '.data'
if ((Test-Path -LiteralPath $dataDirectory) -and (Test-Link (Get-Item -LiteralPath $dataDirectory -Force))) {
    throw 'Linked data directory refused'
}
if (-not (Test-Path -LiteralPath $reportDirectory)) { New-Item -ItemType Directory -Path $reportDirectory | Out-Null }
$reportDirectory = Assert-LocalPath $reportDirectory
foreach ($entry in @((Join-Path $projectRoot '.data'), $reportDirectory)) {
    if (Test-Link (Get-Item -LiteralPath $entry -Force)) { throw "Linked report directory refused: $entry" }
}
$reportPath = Join-Path $reportDirectory ('cache-cleanup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$report = [ordered]@{ status='started'; targets=$plan; bytes=$total; completed=@() }
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
foreach ($entry in $plan) {
    Remove-LocalTree (Join-Path $projectRoot $entry.path)
    $report.completed += $entry.path
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
}
$report.status = 'complete'
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Host "Local report: $reportPath"
