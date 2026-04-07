#!/bin/bash

# Configuration
PORT=${PORT:-3000}

# Get absolute path to the understanding directory
UNDERSTANDING_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$UNDERSTANDING_ROOT"

# Use system node
NODE_BIN=$(which node)

echo "--- Starting Understanding Graph Visualizer ---"
echo "Root: $UNDERSTANDING_ROOT"
echo "Node: $($NODE_BIN -v)"

# 1. Build check
if [ ! -d "packages/web-server/dist" ]; then
    echo "Building packages..."
    $NODE_BIN $(which npm) run build
fi

# 2. Frontend Symlink Fix
# We need packages/web-server/client to point to packages/frontend/dist
CLIENT_LINK="$UNDERSTANDING_ROOT/packages/web-server/client"
FRONTEND_DIST="$UNDERSTANDING_ROOT/packages/frontend/dist"

if [ -L "$CLIENT_LINK" ]; then
    rm "$CLIENT_LINK"
elif [ -d "$CLIENT_LINK" ]; then
    rm -rf "$CLIENT_LINK"
fi

echo "Linking frontend..."
ln -s "$FRONTEND_DIST" "$CLIENT_LINK"

# 3. Launch
echo "Launching server at http://localhost:$PORT"
export PORT=$PORT
exec "$NODE_BIN" "$UNDERSTANDING_ROOT/packages/web-server/dist/index.js"