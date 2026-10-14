# Builds the front end (first run or with -Rebuild) and starts LoanPilot on http://localhost:5080.
# Extra arguments are passed to the API, e.g. .\start.ps1 --data-dir .\my-data
param([switch]$Rebuild, [Parameter(ValueFromRemainingArguments = $true)][string[]]$ApiArgs)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($Rebuild -or -not (Test-Path 'backend/src/LoanPilot.Api/wwwroot/index.html')) {
    Write-Host 'Building the web interface...'
    Push-Location frontend
    try {
        npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
        npm run build; if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
    } finally { Pop-Location }
}

Write-Host 'Starting LoanPilot on http://localhost:5080 (Ctrl+C to stop)'
dotnet run --project backend/src/LoanPilot.Api -c Release -- @ApiArgs
