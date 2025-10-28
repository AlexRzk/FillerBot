# Development Guide

This document provides detailed guidance for implementing missing functionality marked with `// TODO` throughout the codebase.

## Quick Implementation Roadmap

### Priority 1: Core Functionality (Get Working)

1. **Real Settlement Contract Interaction** (`src/submitter/submitter.ts`)
   - [ ] Uncomment transaction construction code
   - [ ] Connect to actual `MockSettlement` contract from deploy
   - [ ] Test submission locally

2. **Plan Building** (`src/planner/planner.ts`)
   - [ ] Implement actual swap routing calculation
   - [ ] Add proper gas estimation integration
   - [ ] Connect to `MockAMM` for pricing

3. **Simulation** (`src/simulator/simulator.ts`)
   - [ ] Implement real callStatic against deployed contracts
   - [ ] Add price impact simulation
   - [ ] Implement slippage tolerance checks

### Priority 2: Production Features (Scale Up)

1. **Multi-RPC Failover** (`src/eth/provider.ts`)
   - [ ] Add backup RPC URLs
   - [ ] Implement retry logic with exponential backoff
   - [ ] Add health checks

2. **Real Intent Feeds** (`src/listener/apiListener.ts`)
   - [ ] Integrate CoW Protocol orderbook API
   - [ ] Add WebSocket support for real-time updates
   - [ ] Implement order subscription and filtering

3. **MEV Protection** (`src/submitter/submitter.ts`)
   - [ ] Integrate Flashbots relay
   - [ ] Add MEV-Blocker support
   - [ ] Implement private pool routing

### Priority 3: Optimization (Performance)

1. **Matcher Optimization** (`src/matcher/matcher.ts`)
   - [ ] Implement hash map indexing (O(n) vs O(n²))
   - [ ] Add batch matching for large intent sets
   - [ ] Implement scoring cache

2. **Database** (`src/db/sqlite.ts`)
   - [ ] Add query indices on frequently searched columns
   - [ ] Implement data migrations
   - [ ] Add transaction support

3. **Metrics** (`src/logger.ts`)
   - [ ] Add structured logging
   - [ ] Integrate observability (Datadog, Prometheus)
   - [ ] Add performance metrics

---

## Detailed Implementation Guides

### Implementing Real Settlement

**File**: `src/submitter/submitter.ts`

**Current**: Mock submission that prints but doesn't execute

**Goal**: Actually send transactions to MockSettlement contract

**Steps**:

1. Get the settlement contract deployment address from `scripts/deploy-mocks.ts` output

2. Add settlement contract ABI:

```typescript
// At top of submitter.ts
const SETTLEMENT_ABI = [
  'function settle(tuple(string id, address maker, address sellToken, address buyToken, uint256 sellAmount, uint256 minBuyAmount, uint256 deadline) intentA, tuple(...) intentB) external returns (bool)',
];
```

3. Construct the transaction:

```typescript
const settlementContract = new ethers.Contract(
  settlementAddress,
  SETTLEMENT_ABI,
  signer
);

const tx = await settlementContract.settle(plan.intentA, plan.intentB, {
  gasLimit: plan.estimatedGas * 120n / 100n, // 20% buffer
  gasPrice: await getGasPrice(),
});
```

4. Wait for confirmation:

```typescript
const receipt = await tx.wait(1);
logger.info(`Settlement confirmed: ${receipt?.transactionHash}`);
```

### Implementing Real Intent Feeds

**File**: `src/listener/apiListener.ts`

**Current**: Stub, no implementation

**Goal**: Fetch intents from CoW Protocol API

**Steps**:

1. Fetch orders from CoW API:

```typescript
export async function startCowListener(
  callback: (intent: Intent) => void
): Promise<() => void> {
  const url = 'https://api.cow.fi/mainnet/orders';
  
  const fetchOrders = async () => {
    const response = await fetch(url);
    const orders = await response.json();
    
    for (const order of orders) {
      const intent = convertCowOrderToIntent(order);
      callback(intent);
    }
  };

  // Poll every 5 seconds
  const intervalId = setInterval(fetchOrders, 5000);
  
  return () => clearInterval(intervalId);
}
```

2. Implement order conversion:

```typescript
function convertCowOrderToIntent(order: any): Intent {
  return {
    id: order.uid,
    maker: order.owner,
    sellToken: order.sellToken.toLowerCase(),
    buyToken: order.buyToken.toLowerCase(),
    sellAmount: BigInt(order.sellAmount),
    minBuyAmount: BigInt(order.minBuyAmount),
    deadline: order.validTo,
    status: 'pending',
    createdAt: Math.floor(Date.now() / 1000),
  };
}
```

### Implementing MEV Protection (Flashbots)

**File**: `src/submitter/submitter.ts`

**Current**: No MEV protection

**Goal**: Route submissions through Flashbots

**Steps**:

1. Install Flashbots SDK:

```bash
npm install @flashbots/ethers-provider-bundle
```

2. Setup Flashbots provider:

```typescript
import {
  FlashbotsBundleProvider,
} from '@flashbots/ethers-provider-bundle';

async function submitWithFlashbots(
  plan: Plan,
  settlementAddress: string
) {
  const provider = getProvider();
  const signer = getSigner();

  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    signer,
    'https://relay.flashbots.net'
  );

  // Build transaction
  const tx = await settlementContract.settle(plan.intentA, plan.intentB);

  // Send as private bundle
  const bundle = [{ signer, transaction: tx }];
  const bundleReceipt = await flashbotsProvider.sendBundle(bundle, {
    maxBlockNumber: await provider.getBlockNumber() + 100,
  });

  return bundleReceipt;
}
```

### Adding Slippage Protection

**File**: `src/utils/math.ts` (already has helpers), used in `src/planner/planner.ts`

**Current**: Placeholders in planner

**Goal**: Calculate and enforce slippage limits

**Steps**:

```typescript
// In planner.ts buildPlan function

const slippageBps = 50; // 0.5%

// Calculate expected amounts with slippage
const amountOutA = simulateSwap(plan.intentA);
const minAmountA = calculateMinAmount(amountOutA, slippageBps);

// Store in plan
plan.expectedOutputs = {
  amountForA: amountOutA,
  amountForB: calculateSwap(plan.intentB),
};

// Submitter will verify these minimums
```

### Implementing Database Migrations

**File**: `src/db/sqlite.ts`

**Current**: Schema created inline

**Goal**: Versioned schema with migrations

**Steps**:

1. Create migration table:

```typescript
function runMigrations(db: Database) {
  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration 001: Initial schema (already applied)
  applyMigration(db, '001_initial_schema', () => {
    // ... existing schema creation
  });

  // Migration 002: Add new column
  applyMigration(db, '002_add_gas_price_column', () => {
    db.exec('ALTER TABLE runs ADD COLUMN gasPrice TEXT');
  });
}

function applyMigration(db: Database, name: string, fn: () => void) {
  const existing = db.prepare(
    'SELECT id FROM migrations WHERE name = ?'
  ).get(name);
  
  if (!existing) {
    fn();
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
    logger.info(`Applied migration: ${name}`);
  }
}
```

---

## Testing Your Implementations

### Unit Testing

```bash
# Test only your new function
npm run test -- test/unit --testNamePattern="your function name"

# Watch mode for development
npm run test -- --watch
```

Example test:

```typescript
describe('Real Settlement', () => {
  it('should submit and confirm transaction', async () => {
    const result = await submitPlan(mockPlan, SETTLEMENT_ADDRESS);
    
    expect(result.success).toBe(true);
    expect(result.txHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(result.receipt).toBeDefined();
  });
});
```

### Integration Testing

```bash
# Run with local node (slower)
npm run test -- test/integration

# With debugging
DEBUG=* npm run test -- test/integration
```

### Manual Testing

```bash
# Start local node
bash scripts/start-local.sh

# In another terminal
npm run demo

# Or run your code directly
npx ts-node -e "
  import { ... } from './src/...';
  // Your test code
"
```

---

## Debugging Tips

### Enable Debug Logging

```bash
# Run with debug output
DEBUG=intent-solver npm run dev

# Or set in .env
LOG_LEVEL=debug
```

### Inspect Contract Calls

```typescript
// Add to any contract interaction:
import { ethers } from 'ethers';

const iface = new ethers.Interface(ABI);
const decoded = iface.parseTransaction({ data: txData });
console.log('Function:', decoded?.name);
console.log('Args:', decoded?.args);
```

### Trace Transaction Execution

```bash
# Use Hardhat's tracer
npx hardhat test --trace

# Or use Etherscan-style simulation
# https://dashboard.tenderly.co/ (free account)
```

---

## Performance Optimization Checklist

- [ ] Profile matcher algorithm for >1000 intents
- [ ] Add query indices to database (`CREATE INDEX idx_status ON intents(status)`)
- [ ] Implement intent caching in matcher
- [ ] Batch simulate multiple plans in parallel
- [ ] Add rate limiting to RPC calls
- [ ] Implement request deduplication

### Profiling Code

```typescript
// Time a function
const startTime = performance.now();
await expensiveFunction();
const elapsed = performance.now() - startTime;
console.log(`Function took ${elapsed}ms`);

// Profile memory
console.log('Memory:', process.memoryUsage());

// Use Node.js profiler
// node --prof src/index.ts
// node --prof-process isolate-*.log > profile.txt
```

---

## Common Issues & Solutions

### Issue: "Cannot find module 'ethers'"

**Cause**: Dependencies not installed

**Fix**:
```bash
npm install
npm run build
```

### Issue: "Settlement contract reverted"

**Cause**: Invalid intent parameters or insufficient liquidity

**Fix**:
1. Check intent deadlines are in future
2. Verify token addresses in MockAMM
3. Ensure liquidity is seeded in `deploy-mocks.ts`

### Issue: "Gas estimation failed"

**Cause**: Transaction would revert

**Fix**:
1. Use callStatic first to test
2. Add error handling in simulator
3. Verify contract state before submitting

---

## Security Checklist Before Production

- [ ] Private keys never in source code (use .env)
- [ ] All ENABLE_LIVE checks present
- [ ] Slippage tolerance enforced
- [ ] Gas limits validated
- [ ] Contract addresses verified (checksummed)
- [ ] MEV protection implemented
- [ ] Rate limiting added
- [ ] Error recovery tested
- [ ] Database backups configured
- [ ] Monitoring alerts set up

---

## Next Steps

1. **Implement one priority 1 item** from roadmap
2. **Write tests** for your implementation
3. **Test locally** with `npm run demo`
4. **Document** any assumptions or limitations
5. **Create pull request** with clear description

---

## Resources

- [ethers.js v6 Docs](https://docs.ethers.org/v6/)
- [Hardhat Testing](https://hardhat.org/hardhat-runner/docs/guides/test)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Flashbots Documentation](https://docs.flashbots.net/)
- [CoW Protocol API](https://api.cow.fi/)

---

Good luck! 🚀
