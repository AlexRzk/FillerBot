# Intent Solver

A minimal, locally-runnable TypeScript intent solver/filler bot for testing and development. Matches complementary token swap intents, simulates execution, and settles on a local test network.

## Overview

**Intent Solver** is a complete blockchain infrastructure project that demonstrates how to build an automated intent-matching system. It includes:

- **Intent Matching**: Finds complementary swap intents (e.g., Alice wants to swap ETH for USDC, Bob wants to swap USDC for ETH)
- **Plan Building**: Constructs execution sequences with gas estimation
- **Simulation**: Tests plans against local mock contracts using `callStatic` (read-only, no state change)
- **Settlement**: Executes profitable trades on a local test network
- **Database**: Tracks intents and execution runs in SQLite
- **Safety-First**: Default local mode; real network submission gated behind `ENABLE_LIVE=true`

## Features

✅ **TypeScript + ethers.js v6** - Type-safe blockchain interactions  
✅ **Local-First**: Anvil/Hardhat for testing, no real network calls by default  
✅ **Mock Contracts**: `MockAMM.sol` and `MockSettlement.sol` for deterministic testing  
✅ **Database**: SQLite for intent and run persistence  
✅ **Unit & Integration Tests**: Jest with examples for matcher logic  
✅ **CI/CD Ready**: GitHub Actions workflow included  
✅ **Production-Grade**: Extensive TODO comments guiding next steps  

---

## Quick Start (3 Commands)

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Local Environment

```bash
# Start Anvil node and deploy mock contracts
bash scripts/start-local.sh
```

In another terminal:

### 3. Run Demo

```bash
npm run demo
```

Expected output:
```
╔════════════════════════════════════════════════════════╗
║          Intent Solver Demo - Local Mode              ║
╚════════════════════════════════════════════════════════╝

📋 Mock intents:
  1. mock-intent-1 : 1000000000000000000@0xaaaaaa... -> 900000000000000000@0xbbbbbb...
  2. mock-intent-2 : 950000000000000000@0xbbbbbb... -> 850000000000000000@0xaaaaaa...
  ...

⏱️  Demo will run for 10 seconds
...
╔════════════════════════════════════════════════════════╗
║               Demo Summary                             ║
╚════════════════════════════════════════════════════════╝

📊 Execution Results:
   Total runs: 1
   Profitable runs: 0
   Failed runs: 1
```

---

## Prerequisites

### Node.js 20+

```bash
node --version  # Should be v20.0.0 or higher
```

### Foundry (Anvil)

For a fast, local test network:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
anvil --version
```

> **Alternative**: If Anvil is not available, the project will fall back to Hardhat (`npx hardhat node`), but Anvil is recommended for speed.

---

## Project Structure

```
intent-solver/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── config.ts                # Configuration loading (env vars)
│   ├── logger.ts                # Logging utilities
│   ├── eth/
│   │   └── provider.ts          # Ethers.js provider/signer setup
│   ├── db/
│   │   └── sqlite.ts            # Database layer
│   ├── models/
│   │   └── intent.ts            # Intent model and validation
│   ├── listener/
│   │   ├── mockFeed.ts          # Synthetic intent generator
│   │   └── apiListener.ts       # Stub for real feeds (CoW, 1inch, etc.)
│   ├── matcher/
│   │   └── matcher.ts           # Intent pairing algorithm
│   ├── planner/
│   │   └── planner.ts           # Plan building
│   ├── simulator/
│   │   └── simulator.ts         # Plan simulation (callStatic)
│   ├── submitter/
│   │   └── submitter.ts         # Transaction submission
│   ├── monitor/
│   │   └── monitor.ts           # Main orchestration loop
│   └── utils/
│       ├── eth.ts               # Ethereum utilities
│       └── math.ts              # BigInt arithmetic
│
├── contracts/
│   ├── MockAMM.sol              # Uniswap-like AMM mock
│   └── MockSettlement.sol       # Settlement contract mock
│
├── scripts/
│   ├── start-local.sh           # Start Anvil + deploy mocks
│   ├── deploy-mocks.ts          # Hardhat deployment script
│   └── demo.ts                  # Demo runner
│
├── test/
│   ├── unit/
│   │   └── matcher.test.ts      # Matcher unit tests
│   └── integration/
│       └── fullFlow.test.ts     # End-to-end test
│
├── seeds/
│   └── mock_intents.json        # Mock intent data
│
├── package.json
├── tsconfig.json
├── jest.config.js
├── hardhat.config.ts
├── .env.example
└── README.md (this file)
```

---

## Configuration

Copy and customize the environment file:

```bash
cp .env.example .env
```

### Key Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MODE` | `local` | `local` (test) or `live` (mainnet) |
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `PRIVATE_KEY` | test key | Signing key (dev/test only!) |
| `ENABLE_LIVE` | `false` | Must be `true` for live submission |
| `DATABASE_PATH` | `./data/bot.db` | SQLite database file |
| `MOCK_FEED_FILE` | `./seeds/mock_intents.json` | Mock intents source |
| `MIN_PROFIT_THRESHOLD` | `1000000000000000` | Min profit to submit (wei) |

### ⚠️ Safety Warning

**Never commit real private keys or live RPC URLs.** Use a `.env.local` file for local development:

```bash
echo ".env.local" >> .gitignore
# Edit .env.local with your test keys
```

---

## Usage

### Run Tests

```bash
# Unit tests only (fast)
npm run test -- test/unit

# All tests (slower, includes integration)
npm run test

# Watch mode
npm run test -- --watch
```

### Build TypeScript

```bash
npm run build
# Output in ./dist
```

### Run in Development Mode

```bash
npm run dev
# Starts monitor loop with live TypeScript compilation
```

### Lint and Format

```bash
npm run lint           # Check for errors
npm run lint:fix       # Auto-fix issues
npm run format         # Format code with Prettier
```

### Database Inspection

Query the SQLite database directly:

```bash
sqlite3 ./data/bot.db

# View intents table
sqlite> SELECT id, status, sellAmount, minBuyAmount FROM intents;

# View executed runs
sqlite> SELECT * FROM runs WHERE status = 'executed';

# Calculate total profit
sqlite> SELECT SUM(actualProfit) as total_profit FROM runs WHERE actualProfit > 0;

sqlite> .quit
```

---

## How It Works

### The Matching & Settlement Flow

1. **Listen**: Intents arrive via `mockFeed.ts` (or real API in the future)
2. **Persist**: Store intents in SQLite database
3. **Match**: `matcher.ts` finds complementary pairs using token pair analysis
4. **Plan**: `planner.ts` builds transaction sequences with gas estimates
5. **Simulate**: `simulator.ts` tests with `callStatic` (read-only, safe!)
6. **Score**: Rank by profitability (output - input - gas)
7. **Submit**: If profitable, send to `MockSettlement.sol` or real settlement
8. **Record**: Log runs and update intent statuses in DB
9. **Repeat**: Wait and loop

### Example: Atomic Swap Settlement

```
Intent A (from Alice):          Intent B (from Bob):
  Sell: 1000 USDC    ────────→  Buy: 1000 USDC
  Buy:  1 ETH        ←────────  Sell: 1 ETH

Settlement Contract (atomic):
1. Receive 1000 USDC from Alice
2. Receive 1 ETH from Bob
3. Swap 1000 USDC for 1 ETH via AMM
4. Send 1 ETH to Alice (+ profit)
5. Send ~950 USDC to Bob (+ profit)
6. Emit SettlementExecuted(profitAmount)
```

---

## Extending to Live Networks

### To Enable Live Submission

1. **Set `ENABLE_LIVE=true`** in `.env`:
   ```bash
   ENABLE_LIVE=true
   MODE=live
   RPC_URL=https://mainnet.optimism.io  # or your provider
   ```

2. **Uncomment real submission code** in `src/submitter/submitter.ts`

3. **Implement settlement logic** for your target protocol:
   - CoW Protocol: See commented example in `submitter.ts`
   - Uniswap X: Implement in `planner.ts`
   - 1inch Fusion: Extend `apiListener.ts`

4. **Add security measures**:
   - Implement slippage checks (see `math.ts`)
   - Add MEV protection (Flashbots, MEV-Blocker)
   - Monitor gas prices and backpressure
   - Add rate limiting and circuit breakers

5. **Review and test**:
   - Run full test suite: `npm run test`
   - Test on testnet first (Sepolia, Optimism Goerli)
   - Monitor logs for errors: `tail -f logs/combined.log`

### Example: CoW Protocol Integration

```typescript
// In src/listener/apiListener.ts
export async function startCowListener(callback: (intent: Intent) => void) {
  const response = await fetch('https://api.cow.fi/mainnet/orders');
  const orders = await response.json();
  for (const order of orders) {
    const intent = convertCowOrderToIntent(order);
    callback(intent);
  }
}
```

---

## Monitoring & Debugging

### Logs

```bash
# View live logs
npm run dev 2>&1 | tee logs/app.log

# Filter for errors only
grep ERROR logs/app.log

# Monitor monitor cycles
grep "Monitor cycle" logs/app.log | tail -20
```

### Database Metrics

```bash
# Count intents by status
sqlite3 ./data/bot.db "SELECT status, COUNT(*) FROM intents GROUP BY status;"

# Most recent executed runs
sqlite3 ./data/bot.db "SELECT id, actualProfit, createdAt FROM runs ORDER BY createdAt DESC LIMIT 5;"

# Total PnL
sqlite3 ./data/bot.db "SELECT SUM(actualProfit) FROM runs WHERE actualProfit > 0;"
```

### Hardhat RPC Calls

```bash
# Check block number
curl http://127.0.0.1:8545 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Get balance
curl http://127.0.0.1:8545 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x1234..."],"id":1}'
```

---

## Common Issues & Solutions

### "Port 8545 already in use"

```bash
# Kill existing process
lsof -i :8545 | grep -v PID | awk '{print $2}' | xargs kill -9

# Or run on a different port
anvil --port 8546
```

### "ENABLE_LIVE=true required" error

```bash
# You tried to run in live mode without explicit opt-in
# Set ENABLE_LIVE=true in .env (only for real networks!)
# In .env:
ENABLE_LIVE=true
```

### Tests timeout

Increase Jest timeout in `jest.config.js`:

```javascript
testTimeout: 60000, // 60 seconds
```

### No intents being matched

1. Check `seeds/mock_intents.json` exists and has valid data
2. Verify intent tokens are complementary:
   - Intent A: sell Token X, buy Token Y
   - Intent B: sell Token Y, buy Token X
3. Check deadlines haven't expired

---

## Contributing

TODO: Add contributing guidelines

### Development Checklist

- [ ] Write tests for new features
- [ ] Update `src/**/**.ts` files with relevant TODOs
- [ ] Run linter: `npm run lint`
- [ ] Ensure all tests pass: `npm run test`
- [ ] Update README with new configuration or features

---

## Production Deployment

> **⚠️ WARNING**: This is a reference implementation. Before deploying to production:

- [ ] Conduct security audit
- [ ] Implement comprehensive error handling and circuit breakers
- [ ] Add distributed locking for multi-instance deployments
- [ ] Set up monitoring, alerting, and log aggregation
- [ ] Test thoroughly on testnets
- [ ] Implement MEV protection (Flashbots, MEV-Blocker)
- [ ] Add slippage monitoring and dynamic pricing
- [ ] Implement cost accounting and profitability metrics
- [ ] Review all TODOs in codebase

---

## Architecture Notes

### Design Principles

1. **Local-First**: Default safe mode (local test network)
2. **Type-Safe**: Full TypeScript types throughout
3. **Observable**: Extensive logging for debugging
4. **Extensible**: TODO comments mark future implementations
5. **Testable**: Unit + integration test examples

### Key Trade-offs

- **Simplicity over Performance**: Straightforward matching (O(n²)) vs. optimized index structures
- **Mock Contracts over Real Deployment**: Use Solidity mocks for local testing
- **SQLite over Postgres**: Good enough for single-instance, upgrade for scale
- **Placeholder over Implementation**: TODOs mark areas for production features

---

## Gas Considerations

### Estimated Gas Usage

- `MockAMM.swap()`: ~80k gas
- `MockSettlement.settle()`: ~150k gas per pair

### Profit Calculation

```
Expected Profit = (amountOut_B - amountOut_A_min) + (amountOut_A - amountOut_B_min) - gasUsed * gasPrice
```

Use `MIN_PROFIT_THRESHOLD` to filter unprofitable executions.

---

## References

- [ethers.js Documentation](https://docs.ethers.org/v6/)
- [Foundry Book](https://book.getfoundry.sh/)
- [CoW Protocol](https://cow.fi/)
- [Uniswap](https://uniswap.org/)
- [1inch Fusion](https://fusion.1inch.io/)

---

## License

MIT

---

## FAQ

### Q: Can I use this in production?

**A**: Not without extensive modifications. This is a reference implementation for learning. Review all TODOs, add error handling, implement MEV protection, and conduct security audits before mainnet deployment.

### Q: How do I connect to a real network?

**A**: Set `MODE=live`, `ENABLE_LIVE=true`, and provide a valid `RPC_URL`. Implement real settlement logic in `src/submitter/submitter.ts`. Test on testnet first!

### Q: What's the minimum profit threshold?

**A**: Set `MIN_PROFIT_THRESHOLD` in `.env`. Default is `1000000000000000` wei (0.001 ETH equivalent). Adjust based on your gas costs and slippage tolerance.

### Q: How do I add a new intent feed?

**A**: Implement a listener in `src/listener/` that fetches intents from your API and calls the intent callback. See `apiListener.ts` for template.

### Q: How do I scale this to multiple chains?

**A**: Add chain configuration in `src/config.ts`, implement per-chain provider management in `src/eth/provider.ts`, and run separate monitor instances per chain.

---

**Last Updated**: October 2025  
**Status**: ✅ Ready for local testing and development
