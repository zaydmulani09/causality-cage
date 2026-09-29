# Section 1 demo, end to end (PowerShell). Records a failing and a passing session from the example shop
# (BUG=demo), then runs `cage explain` and opens the report. Run from anywhere: .\scripts\demo.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$cli = Join-Path $root 'packages/cli/bin/cage.mjs'
function cage { node $cli @args; if ($LASTEXITCODE -gt 4) { throw "cage failed ($LASTEXITCODE)" } }

function Start-Shop([string]$scenario, [int]$port) {
  $env:BUG = 'demo'; $env:SCENARIO = $scenario; $env:PORT = "$port"
  $p = Start-Process node -ArgumentList 'examples/shop/server.mjs' -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 50; $i++) {
    try { Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 1 | Out-Null; return $p } catch { Start-Sleep -Milliseconds 100 }
  }
  throw "shop did not start on port $port"
}

pnpm shop:build | Out-Null
New-Item -ItemType Directory -Force examples/sessions | Out-Null
$bad = Start-Shop 'bad' 5173
$good = Start-Shop 'good' 5174
try {
  Set-Location examples
  cage record flows/checkout.ts --base-url http://127.0.0.1:5173 --out sessions/bad.json --label bad --oracle oracles/no-crash.ts
  cage record flows/checkout.ts --base-url http://127.0.0.1:5174 --out sessions/good.json --label good --oracle oracles/no-crash.ts
  Stop-Process -Id $good.Id
  Clear-Host
  Write-Host '> cage explain --flow flows/checkout.ts --oracle oracles/no-crash.ts --bad sessions/bad.json --good sessions/good.json' -ForegroundColor Cyan
  cage explain --flow flows/checkout.ts --oracle oracles/no-crash.ts --bad sessions/bad.json --good sessions/good.json --out result.cage --open
} finally {
  Set-Location $root
  Stop-Process -Id $bad.Id -ErrorAction SilentlyContinue
  Stop-Process -Id $good.Id -ErrorAction SilentlyContinue
}
