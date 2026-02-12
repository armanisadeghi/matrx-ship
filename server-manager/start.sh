#!/bin/bash
set -e

# Start the Express API server (port 3000)
node src/index.js &
API_PID=$!

# Start the Next.js admin server (port 3001)
cd /app/admin
PORT=3001 HOSTNAME=0.0.0.0 node server.js &
ADMIN_PID=$!

# Wait for either process to exit
wait -n $API_PID $ADMIN_PID
EXIT_CODE=$?

# Kill the other process
kill $API_PID $ADMIN_PID 2>/dev/null || true

exit $EXIT_CODE
