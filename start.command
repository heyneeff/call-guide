#!/bin/bash
# Double-click to open the call guide at http://localhost:8765
# (A fixed port keeps your saved calls in the same browser storage every time.)
cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT"

if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

(sleep 1 && open "$URL") &
echo "Call guide running at $URL. Close this window to stop it."
exec python3 -m http.server $PORT --bind 127.0.0.1
