#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Run Install Fetch Agent.command first."
  read -r -p "Press Enter to close…"
  exit 1
fi
if [ ! -f .env.local ]; then
  echo "No .env.local — running setup first…"
  node scripts/first-run.mjs
fi
echo ""
echo "Fetch Agent running — keep this window open while fetching in the portal."
echo "Press Ctrl+C to stop."
echo ""
npm start
