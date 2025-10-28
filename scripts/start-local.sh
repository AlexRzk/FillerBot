#!/bin/bash
# scripts/start-local.sh
# PURPOSE: Start a local development environment with Anvil/Hardhat and deploy mock contracts.
# SAFETY: All operations are local; no mainnet interaction.
# 
# FLOW:
# 1. Check for running Anvil instance, kill if present
# 2. Start Anvil (Foundry) or Hardhat node
# 3. Deploy mock contracts
# 4. Print deployed addresses
# 5. Keep running (user can Ctrl+C to stop)
# 
# REQUIREMENTS:
# - Node.js 20+
# - Foundry (anvil) installed OR Hardhat
# 
# USAGE:
#   bash scripts/start-local.sh

set -e

echo "╔═══════════════════════════════════════════════════╗"
echo "║     Starting Local Development Environment       ║"
echo "╚═══════════════════════════════════════════════════╝"

# Configuration
RPC_PORT=8545
ANVIL_PID_FILE="/tmp/anvil.pid"
CHAIN_ID=31337

# Cleanup function
cleanup() {
    echo ""
    echo "Shutting down local environment..."
    
    # Kill Anvil if running
    if [ -f "$ANVIL_PID_FILE" ]; then
        ANVIL_PID=$(cat "$ANVIL_PID_FILE")
        if ps -p "$ANVIL_PID" > /dev/null 2>&1; then
            echo "Killing Anvil (PID: $ANVIL_PID)..."
            kill "$ANVIL_PID" 2>/dev/null || true
            sleep 1
        fi
        rm -f "$ANVIL_PID_FILE"
    fi
    
    exit 0
}

trap cleanup EXIT INT TERM

# Check if port is already in use
check_port() {
    if command -v lsof &> /dev/null; then
        if lsof -i ":$RPC_PORT" > /dev/null 2>&1; then
            echo "⚠️  Port $RPC_PORT is already in use"
            return 1
        fi
    fi
    return 0
}

# Try to start Anvil (Foundry)
start_anvil() {
    echo ""
    echo "📦 Checking for Foundry (Anvil)..."
    
    if ! command -v anvil &> /dev/null; then
        echo "❌ Anvil not found. Install Foundry:"
        echo "   curl -L https://foundry.paradigm.xyz | bash"
        echo "   foundryup"
        return 1
    fi
    
    echo "✅ Anvil found. Starting local node..."
    
    if ! check_port; then
        echo "❌ Cannot start Anvil: port $RPC_PORT already in use"
        return 1
    fi
    
    # Start Anvil in background
    anvil --port $RPC_PORT --chain-id $CHAIN_ID > /tmp/anvil.log 2>&1 &
    ANVIL_PID=$!
    echo $ANVIL_PID > "$ANVIL_PID_FILE"
    
    echo "✅ Anvil started (PID: $ANVIL_PID)"
    
    # Wait for Anvil to be ready
    echo "⏳ Waiting for Anvil to be ready..."
    for i in {1..30}; do
        if curl -s http://127.0.0.1:$RPC_PORT -X POST \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            > /dev/null 2>&1; then
            echo "✅ Anvil is ready!"
            return 0
        fi
        sleep 1
    done
    
    echo "❌ Anvil failed to start. Check logs:"
    tail -20 /tmp/anvil.log
    return 1
}

# Fallback: use Hardhat node (if Anvil not available)
start_hardhat_node() {
    echo ""
    echo "📦 Anvil not available. Trying Hardhat..."
    
    if ! check_port; then
        echo "❌ Cannot start Hardhat: port $RPC_PORT already in use"
        return 1
    fi
    
    # Note: We would start hardhat node in background, but for simplicity,
    # we'll just recommend using Anvil
    echo "❌ Hardhat background support not fully implemented"
    echo "   Please install Foundry or run 'npx hardhat node' separately"
    return 1
}

# Deploy mock contracts
deploy_mocks() {
    echo ""
    echo "🚀 Deploying mock contracts..."
    
    if ! npx hardhat run scripts/deploy-mocks.ts --network localhost; then
        echo "❌ Mock deployment failed"
        return 1
    fi
    
    echo "✅ Mock contracts deployed"
}

# Main
echo "ℹ️  RPC will be available at http://127.0.0.1:$RPC_PORT"
echo "ℹ️  Chain ID: $CHAIN_ID"
echo ""

# Start local node
if ! start_anvil; then
    if ! start_hardhat_node; then
        echo "❌ Failed to start local node"
        exit 1
    fi
fi

# Deploy contracts
if ! deploy_mocks; then
    echo "⚠️  Contract deployment failed, but node is running"
fi

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║   Local Environment Ready!                        ║"
echo "║   RPC: http://127.0.0.1:$RPC_PORT                ║"
echo "║   Press Ctrl+C to shutdown                        ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# Keep running
wait
