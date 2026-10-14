#!/usr/bin/env bash
# Builds the front end (first run or when --rebuild is passed) and starts LoanPilot on http://localhost:5080.
# Extra arguments are passed to the API, e.g. ./start.sh --data-dir ./my-data
set -euo pipefail
cd "$(dirname "$0")"

rebuild=false
args=()
for arg in "$@"; do
  if [[ "$arg" == "--rebuild" ]]; then rebuild=true; else args+=("$arg"); fi
done

if [[ "$rebuild" == true || ! -f backend/src/LoanPilot.Api/wwwroot/index.html ]]; then
  echo "Building the web interface..."
  (cd frontend && npm ci && npm run build)
fi

echo "Starting LoanPilot on http://localhost:5080 (Ctrl+C to stop)"
exec dotnet run --project backend/src/LoanPilot.Api -c Release -- "${args[@]}"
