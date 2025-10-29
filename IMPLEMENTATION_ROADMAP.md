# Implementation Roadmap: From Testing to Live Filling

## Current State

Your bot **CAN**:
- ✅ Detect pending orders from Base mainnet mempool
- ✅ Log filled orders with correct filler/swapper addresses
- ✅ Monitor order amounts and potential gains
- ✅ Match complementary order pairs
- ✅ Simulate execution with gas estimates
- ✅ Calculate profitability with safety limits

Your bot **CANNOT** (yet):
- ❌ Actually submit fills to the blockchain
- ❌ Handle real settlement contract interaction
- ❌ Calculate real token prices (needs decoder fix)
- ❌ Track actual profit/loss from executed trades

---

## Critical Path to Live Filling

### Phase 1: Get Order Data Working (CURRENT - 70% DONE)

**Status**: Mempool detection works, but decoder returns zeros.

**Next Steps**:
1. Fix `src/utils/uniswapxDecoder.ts` to decode actual order data (not zeros)
   - Currently stub returning placeholder amounts
   - Need to decode the actual Priority Order struct

2. Verify amounts in logs:
```bash
npm run dev
# Watch for:
[info]    Input: 1000.5 USDC...  ← Should NOT be 0
[info]    Output: 1001.2 WETH... ← Should NOT be 0
[info]    💰 Potential gain: +0.7 ← Should NOT be 0
```

**Estimated Time**: 2-4 hours

---

### Phase 2: Implement Settlement (CRITICAL - 0% DONE)

**Status**: `submitPlan()` is a stub.

**What Needs to Happen**:

1. **Get Settlement Contract ABI**
   ```typescript
   // File: src/contracts/settlementAbi.ts
   export const SETTLEMENT_ABI = [
     // Need to get this from UniswapX
     // Likely functions: settle(), fill(), executeOrder()
   ];
   ```

2. **Implement Transaction Building**
   ```typescript
   // File: src/submitter/submitter.ts - replaceSubmitPlan()
   function buildSettlementTransaction(plan: Plan, settlementAddress: string) {
     const settlement = new ethers.Contract(
       settlementAddress,
       SETTLEMENT_ABI,
       signer
     );
     
     // Encode the actual settlement call
     return settlement.settle(plan.intentA, plan.intentB, {
       gasLimit: plan.estimatedGas,
       gasPrice: await getGasPrice(),
     });
   }
   ```

3. **Send Real Transaction**
   ```typescript
   // Replace mock with real submission
   const tx = await buildSettlementTransaction(plan, settlementAddress);
   const receipt = await tx.wait(1);
   return { success: true, txHash: tx.hash, receipt };
   ```

**Estimated Time**: 4-6 hours (assuming UniswapX SDK available)

---

### Phase 3: Test on Sepolia (CRITICAL - 0% DONE)

**Setup**:
```bash
# 1. Update .env for Sepolia
MODE=local  # Start safe
CHAIN_ID=84532  # Base Sepolia
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY

# 2. Get test funds
# - https://www.alchemy.com/faucets/base-sepolia
# - Get 0.5 Sepolia ETH + 1000 test USDC

# 3. Deploy mock contracts or use existing
npm run demo

# 4. Test order filling
npm run dev  # Should see fills in logs
```

**Success Metrics**:
- ✅ Bot detects test orders
- ✅ Matches complementary pairs
- ✅ Submits transactions successfully
- ✅ Receives settlement amounts correctly

**Estimated Time**: 2-3 hours of testing

---

### Phase 4: Move to Base Mainnet (CRITICAL - 0% DONE)

**Enable Live Mode**:
```bash
# Update .env
MODE=live
ENABLE_LIVE=true
CHAIN_ID=8453
PRIVATE_KEY=0x...  # Your funded wallet
RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

**Safety Verification**:
```typescript
// src/config.ts already has these checks:
✅ if (mode === 'live' && !enableLive) throw Error
✅ Circuit breaker prevents losses
✅ Position size limited to $50
✅ Min profit threshold prevents gas-wasting fills
```

**Startup Steps**:
```bash
# 1. Rebuild
npm run build

# 2. Start with logging to file
npm run dev 2>&1 | tee bot.log

# 3. Monitor first 10 fills carefully
# Watch for:
# - [info] ✅ Order filled on-chain
# - [info] 💰 Profit: $X.XX
# - [stats] Total P&L: $X.XX

# 4. Stop immediately if:
# - [error] Circuit breaker paused
# - [stats] Net loss accumulating
```

**Estimated Time**: 1 hour to verify safety, then continuous operation

---

## Detailed Implementation Tasks

### Task 1: Fix Order Decoder

**File**: `src/utils/uniswapxDecoder.ts`

**Current**: Returns all zeros for every transaction

**Fix Required**:
```typescript
export function decodePriorityOrderCalldata(txData: string): DecodedPriorityOrder {
  // Currently returns:
  // {
  //   inputAmount: 0n,
  //   outputAmount: 0n,
  //   ...
  // }
  
  // Should return actual decoded values from transaction data
  // Need to understand Priority Order struct encoding
}
```

**How to Find**: 
- Check UniswapX SDK: `@uniswap/uniswapx-sdk`
- Look for `PriorityOrder` interface
- Use ethers.AbiCoder to decode struct

**Test**:
```bash
npm run dev
# Should see non-zero amounts in logs:
# [info]    Input: 1000.5 USDC
# [info]    Output: 1001.2 WETH
```

---

### Task 2: Implement submitPlan()

**File**: `src/submitter/submitter.ts` (lines 46-180)

**Current**: Mock returns without actually sending

**Changes**:
```typescript
export async function submitPlan(
  plan: Plan,
  settlementAddress: string
): Promise<SubmissionResult> {
  // ... validation code stays same ...

  if (config.mode === 'local') {
    // TODO: Replace this mock:
    const mockTxHash = `0x${'0'.repeat(64)}`;
    return { success: true, txHash: mockTxHash, receipt: null };
    
    // With actual implementation:
    const signer = getSigner();
    const settlement = new ethers.Contract(
      settlementAddress,
      SETTLEMENT_ABI,
      signer
    );
    
    const tx = await settlement.settle(plan.intentA, plan.intentB, {
      gasLimit: plan.estimatedGas,
    });
    
    const receipt = await tx.wait(1);
    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  }
  
  if (config.mode === 'live') {
    // Implement same logic for live network
    // Add Flashbots integration if available
  }
}
```

**Test**:
```bash
# After implementing:
npm run build
npm run demo  # Should execute fills successfully
```

---

### Task 3: Add Real Token Price Calculation

**File**: `src/services/priceOracleService.ts`

**Current**: Uses Chainlink but has stale data warnings

**Needed**:
```typescript
// Get real prices for gain calculation
const inputPrice = await oracle.getPrice(decoded.inputToken);
const outputPrice = await oracle.getPrice(decoded.outputToken);

const gain = (
  (outputAmount * outputPrice) - (inputAmount * inputPrice)
) / 1e18;  // Convert to USD
```

**How**:
1. Chainlink (already implemented) - use their price feeds
2. Uniswap V3 Oracle - get time-weighted average prices
3. External APIs - CoinGecko, Coinglass

---

### Task 4: Create Settlement Contract Interface

**File**: `src/contracts/settlementContract.ts` (NEW)

```typescript
import { ethers } from 'ethers';

// Get UniswapX settlement contract ABI
export const SETTLEMENT_ABI = [
  // "function settle(Intent memory intentA, Intent memory intentB, ...)"
  // etc.
];

export const SETTLEMENT_ADDRESS = {
  8453: '0x...',      // Base mainnet
  84532: '0x...',     // Base Sepolia
  31337: '0x...',     // Local test
};
```

**Where to Get ABI**:
- UniswapX GitHub: github.com/uniswap/uniswapx-sdk
- Search for `ISettlement.sol` or similar
- Or use Etherscan contract interface

---

### Task 5: Add Monitoring & Metrics

**File**: `src/monitor/metrics.ts` (NEW)

Track:
```typescript
interface FillerMetrics {
  ordersDetected: number;
  pairsFoound: number;
  fillsAttempted: number;
  fillsSuccessful: number;
  totalProfitUSD: number;
  totalGasSpentUSD: number;
  netProfitUSD: number;
  winRate: number;  // Percentage
  avgGainPerFill: number;  // USD
}
```

---

## Priority Order

1. **HIGH**: Fix decoder (Phase 1)
   - Without real amounts, can't calculate profitability
   - Blocks all testing

2. **HIGH**: Implement submitPlan (Phase 2)
   - Core functionality
   - Blocks testing fills

3. **MEDIUM**: Test on Sepolia (Phase 3)
   - Verify system works end-to-end
   - Find bugs before mainnet

4. **MEDIUM**: Add real prices (Task 3)
   - Better profit calculations
   - Improves fill quality

5. **LOW**: Optimize performance (Task 5)
   - Nice to have
   - Doesn't block launches

---

## Estimated Total Timeline

| Phase | Time | Blockers |
|-------|------|----------|
| Phase 1 (Decoder) | 2-4h | ← START HERE |
| Phase 2 (Settlement) | 4-6h | Needs decoder working |
| Phase 3 (Sepolia Test) | 2-3h | Needs settlement working |
| Phase 4 (Mainnet Live) | 1-2h | Needs Sepolia working |
| **TOTAL** | **9-15 hours** | - |

**If you dedicate 4 hours/day**: Could go live in 2-4 days

---

## Questions to Answer Before Implementation

1. **Settlement Contract**: Which UniswapX contract handles fills?
2. **Token Decimals**: How to handle USDC (6), WETH (18), etc.?
3. **Gas Prices**: Use current or estimate-based?
4. **Slippage**: How much tolerance before rejecting a fill?
5. **MEV Protection**: Use Flashbots or public mempool?

Check the documentation or existing open-source filler bots for answers!
