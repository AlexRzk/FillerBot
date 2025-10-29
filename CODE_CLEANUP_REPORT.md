# Code Cleanup Analysis Report

## Project Structure Overview

### Main Source Files (src/)
- **index.ts** - Entry point ✅
- **config.ts** - Configuration ✅
- **logger.ts** - Logging ✅
- **models/intent.ts** - Intent model ✅
- **eth/provider.ts** - Provider setup ✅
- **db/sqlite.ts** - Database ✅
- **contracts/settlementContract.ts** - Settlement interface ✅
- **listener/** - Various listeners (see below)
- **matcher/matcher.ts** - Matching logic ✅
- **planner/planner.ts** - Plan building ✅
- **simulator/simulator.ts** - Simulation ✅
- **submitter/submitter.ts** - Transaction submission ✅
- **monitor/monitor.ts** - Main orchestration ✅
- **utils/** - Utilities ✅
- **services/** - Services ✅
- **config/safety.ts** - Safety config ✅

### Listeners (src/listener/)

| File | Purpose | Status | Usage |
|------|---------|--------|-------|
| **mockFeed.ts** | Synthetic intents from JSON | ✅ Working | Used when intentFeedSource='mock' |
| **realFeed.ts** | Real mempool monitoring | ✅ Working | Used when intentFeedSource='real' |
| **mempoolOrderListener.ts** | WebSocket mempool tracking | ✅ Working | Used in realFeed, provides getPendingMempoolOrders() etc |
| **pendingOrdersListener.ts** | Fill event tracking | ✅ Working | Used in realFeed, provides getOpenOrdersAsIntents() etc |
| **apiListener.ts** | CoW Protocol stub | ⚠️ PLACEHOLDER | NOT USED - This is unimplemented |
| **uniswapXFeed.ts** | UniswapX order monitoring | ⚠️ UNUSED | NOT USED - Imported nowhere |

---

## UNUSED CODE ANALYSIS

### 1. **apiListener.ts** - UNUSED ❌
**Status:** Complete stub, not integrated anywhere
**File Size:** 2600 bytes
**Usage:** 0 imports from this file
**Recommendation:** REMOVE (or keep as TODO template)

### 2. **uniswapXFeed.ts** - UNUSED ❌
**Status:** Fully implemented but not called
**File Size:** 12,036 bytes
**Exports:**
- `fetchUniswapXOrders()` - never called
- `canFillUniswapXOrder()` - never called
**Usage:** 0 imports
**Recommendation:** REMOVE (monitor.ts uses mockFeed or realFeed instead)

### 3. **src/simulator/simulator.ts** - PARTIALLY UNUSED
**Exports:**
- ✅ `simulatePlan()` - USED in simulateAndRankPlans
- ✅ `isProfitable()` - USED in monitor.ts (line 164)
- ✅ `simulateAndRankPlans()` - USED in monitor.ts (line 151)
**Status:** Keep all

### 4. **src/utils/uniswapxDecoder.ts** - UNUSED FUNCTIONS
**Exports:**
- ✅ `decodePriorityOrderCalldata()` - USED in mempoolOrderListener
- ❌ `calculateOrderHash()` - Only self-references (line 259)
- ❌ `verifyOrderHash()` - Never called, just definition
- ❌ `extractOrderFields()` - Never called
- ❌ `formatOrderForLogging()` - Never called (duplicate in settlementContract)
**Recommendation:** Remove unused functions

### 5. **src/contracts/settlementContract.ts** - DUPLICATE FUNCTIONS
**Exports:**
- ✅ `formatOrderForLogging()` - USED
- ✅ Others all used
**Note:** `formatOrderForLogging()` is DUPLICATED in both `uniswapxDecoder.ts` and `settlementContract.ts`
**Recommendation:** Remove from uniswapxDecoder.ts

### 6. **src/index.ts** - UNUSED CONSTANTS
**Constants:**
- ❌ `SETTLEMENT_ADDRESS = '0x9fE46736679d2D9a65F0991C02F50800747f9C5d'`  - PLACEHOLDER, not used
- ❌ `AMM_ADDRESS = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9'` - PLACEHOLDER, not used
**Note:** These are passed to startMonitor() but never used there
**Recommendation:** Remove or make configurable

### 7. **Root-level utility files**

| File | Purpose | Usage |
|------|---------|-------|
| **test-apis.js** | API testing utility | Not used in main flow |
| **jest.config.js** | Jest configuration | ✅ Used by tests |
| **hardhat.config.ts** | Hardhat config | ⚠️ May not be used (bot runs on Base mainnet, not local) |

---

## SUMMARY OF CLEANUP OPPORTUNITIES

### 🔴 HIGH PRIORITY (Remove)

1. **src/listener/apiListener.ts** (2.6 KB)
   - Complete stub with no implementation
   - Not imported anywhere
   - Marked as TODO for future work

2. **src/listener/uniswapXFeed.ts** (12 KB)
   - Fully implemented but never called
   - Bot uses mockFeed or realFeed instead
   - Contains functions: fetchUniswapXOrders(), canFillUniswapXOrder()

3. **src/utils/uniswapxDecoder.ts** - Unused functions (remove):
   - `calculateOrderHash()`
   - `verifyOrderHash()`
   - `extractOrderFields()`
   - `formatOrderForLogging()` (duplicate)

### 🟡 MEDIUM PRIORITY (Optimize)

1. **src/index.ts** - Remove placeholder constants
   - `SETTLEMENT_ADDRESS`
   - `AMM_ADDRESS`
   - Use config-driven approach instead

2. **hardhat.config.ts**
   - Verify if still needed (bot runs on Base mainnet)
   - Can be kept if used for testing contracts

### 🟢 LOW PRIORITY (Keep)

- All other files are used or needed
- test-apis.js is utility, keep for reference
- jest.config.js is needed for testing

---

## CLEANUP TASKS

### Task 1: Remove Unused Listener Files (2 files)
```
DELETE:
- src/listener/apiListener.ts
- src/listener/uniswapXFeed.ts
```

### Task 2: Clean uniswapxDecoder.ts (4 unused functions)
```
DELETE from src/utils/uniswapxDecoder.ts:
- calculateOrderHash()
- verifyOrderHash()
- extractOrderFields()
- formatOrderForLogging()
```

### Task 3: Clean index.ts (2 unused constants)
```
DELETE from src/index.ts:
- SETTLEMENT_ADDRESS constant
- AMM_ADDRESS constant
```

### Task 4: Review Imports
- Remove any imports from deleted files
- Fix imports in monitor.ts if needed

---

## Total Cleanup Impact

| Item | Size | Impact |
|------|------|--------|
| apiListener.ts | 2.6 KB | REMOVE |
| uniswapXFeed.ts | 12 KB | REMOVE |
| Unused functions in decoder | ~400 lines | REMOVE |
| Unused constants in index.ts | ~2 lines | REMOVE |
| **Total** | **~14.6 KB** | Small but tidy |

---

## Files to KEEP (All Used)

✅ src/listener/mockFeed.ts - Used for mock feed
✅ src/listener/realFeed.ts - Used for real feed
✅ src/listener/mempoolOrderListener.ts - Used by realFeed
✅ src/listener/pendingOrdersListener.ts - Used by realFeed
✅ src/matcher/matcher.ts - Used by monitor
✅ src/planner/planner.ts - Used by monitor
✅ src/simulator/simulator.ts - Used by monitor
✅ src/submitter/submitter.ts - Used by monitor
✅ src/monitor/monitor.ts - Main orchestration
✅ src/utils/tradeValidator.ts - Used by monitor
✅ src/utils/priceOracle.ts - Used by monitor
✅ src/utils/circuitBreaker.ts - Used by safety
✅ src/utils/eth.ts - Ethereum utilities
✅ src/utils/math.ts - Math utilities
✅ src/services/priceOracleService.ts - Used by monitor
✅ src/contracts/settlementContract.ts - Used by submitter
✅ src/eth/provider.ts - Used everywhere
✅ src/db/sqlite.ts - Used by monitor and everywhere
✅ src/config.ts - Used everywhere
✅ src/logger.ts - Used everywhere

---

## Implementation Notes

1. **API Listener stub**: Was meant for CoW Protocol integration, but bot uses mempool instead
2. **UniswapX Feed**: Attempted alternative implementation, but bot standardized on mempool listening
3. **Duplicate functions**: Some utility functions are duplicated between modules
4. **Placeholder constants**: index.ts has hardcoded test addresses that should be configurable

---

## Verification Checklist

After cleanup:
- [ ] npm run build succeeds
- [ ] npm run dev starts without errors
- [ ] All imports resolve
- [ ] No "unused variable" warnings from TypeScript
- [ ] Tests still pass (npm run test)
- [ ] Bot still detects and logs orders

