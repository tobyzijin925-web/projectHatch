#!/bin/bash
# Double-click this file in Finder to start Hatch and open it in your browser.
# Closing this Terminal window stops the server.

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org and try again."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

if curl -s -o /dev/null http://127.0.0.1:8132/api/ai-status; then
  echo "Hatch is already running at http://127.0.0.1:8132/"
  open http://127.0.0.1:8132/
  echo "You can close this window — the other server window keeps running."
  read -n 1 -s -r -p "Press any key to close..."
  exit 0
fi

echo "Starting Hatch..."

(
  for _ in $(seq 1 50); do
    sleep 0.2
    if curl -s -o /dev/null http://127.0.0.1:8132/api/ai-status; then
      open http://127.0.0.1:8132/
      break
    fi
  done
) &

exec node server.js
