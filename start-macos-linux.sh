#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 or newer from https://nodejs.org first."
  exit 1
fi
if [ ! -d node_modules/three ]; then npm ci; fi
echo "Open http://localhost:3000 in your browser. Keep this terminal open."
npm start
