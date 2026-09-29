#!/usr/bin/env bash
# Section 1 demo, end to end (bash). Records a failing and a passing session from the example shop
# (BUG=demo), then runs `cage explain` and opens the report. Run from anywhere: ./scripts/demo.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
cage() { node "$root/packages/cli/bin/cage.mjs" "$@"; }

start_shop() { # scenario port
  BUG=demo SCENARIO="$1" PORT="$2" node examples/shop/server.mjs >/dev/null 2>&1 &
  local pid=$!
  for _ in $(seq 50); do curl -fs "http://127.0.0.1:$2/" >/dev/null && break; sleep 0.1; done
  echo "$pid"
}

pnpm shop:build >/dev/null
mkdir -p examples/sessions
bad=$(start_shop bad 5173)
good=$(start_shop good 5174)
trap 'kill $bad $good 2>/dev/null || true' EXIT
cd examples
cage record flows/checkout.ts --base-url http://127.0.0.1:5173 --out sessions/bad.json --label bad --oracle oracles/no-crash.ts
cage record flows/checkout.ts --base-url http://127.0.0.1:5174 --out sessions/good.json --label good --oracle oracles/no-crash.ts
kill "$good"
clear 2>/dev/null || true
echo '> cage explain --flow flows/checkout.ts --oracle oracles/no-crash.ts --bad sessions/bad.json --good sessions/good.json'
cage explain --flow flows/checkout.ts --oracle oracles/no-crash.ts --bad sessions/bad.json --good sessions/good.json --out result.cage --open || true
