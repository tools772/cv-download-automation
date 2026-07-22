#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "Perfect Ventures Fetch Agent — Install"
echo ""
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (18+)"
  read -r -p "Press Enter to close…"
  exit 1
fi
node scripts/first-run.mjs
echo ""
read -r -p "Press Enter to close…"
