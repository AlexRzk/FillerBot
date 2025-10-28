@echo off
REM scripts/start-local.bat
REM PURPOSE: Windows-compatible script to start local development environment
REM USAGE: scripts\start-local.bat
REM
REM This script:
REM 1. Checks for Anvil (Foundry)
REM 2. Starts Anvil on port 8545
REM 3. Deploys mock contracts
REM 4. Prints deployed addresses

setlocal enabledelayedexpansion

echo.
echo ╔═══════════════════════════════════════════════════╗
echo ║     Starting Local Development Environment       ║
echo ╚═══════════════════════════════════════════════════╝
echo.

REM Configuration
set RPC_PORT=8545
set CHAIN_ID=31337

echo ℹ️  RPC will be available at http://127.0.0.1:%RPC_PORT%
echo ℹ️  Chain ID: %CHAIN_ID%
echo.

REM Check if Anvil is available
where anvil >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Anvil not found. Install Foundry:
    echo    1. Visit https://book.getfoundry.sh/getting-started/installation
    echo    2. Or download: https://github.com/foundry-rs/foundry/releases
    exit /b 1
)

echo ✅ Anvil found.
echo 📦 Starting Anvil on port %RPC_PORT%...
echo.

REM Start Anvil
start "Anvil Node" anvil --port %RPC_PORT% --chain-id %CHAIN_ID%

REM Wait for Anvil to start
timeout /t 3 /nobreak

echo ✅ Anvil started
echo ⏳ Deploying mock contracts...
echo.

REM Deploy contracts
call npx hardhat run scripts/deploy-mocks.ts --network localhost

if %ERRORLEVEL% NEQ 0 (
    echo ⚠️  Contract deployment failed
) else (
    echo ✅ Contracts deployed
)

echo.
echo ╔═══════════════════════════════════════════════════╗
echo ║   Local Environment Ready!                        ║
echo ║   RPC: http://127.0.0.1:%RPC_PORT%               ║
echo ║   Close the Anvil window to shutdown              ║
echo ╚═══════════════════════════════════════════════════╝
echo.
echo In another terminal, run:
echo   npm run demo
echo.

pause
