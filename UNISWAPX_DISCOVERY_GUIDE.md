# UniswapX Order Discovery on Base - Complete Implementation Guide

## ✅ Step A: Confirmed - Reactor Contract Addresses for Base

**Official Source**: https://github.com/Uniswap/UniswapX (README - Deployment Addresses)

### Base Mainnet (Chain ID: 8453)
```typescript
// Correct for Base!
const UNISWAPX_PRIORITY_REACTOR_BASE = '0x000000001Ec5656dcdB24D90DFa42742738De729';
const ORDER_QUOTER = '0x88440407634f89873c5d9439987ac4be9725fea8';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// NOT used on Base (these are for Ethereum only):
// const UNISWAPX_V2_REACTOR = '0x00000011F84B9aa48e5f8aA8B9897600006289Be';
// const UNISWAPX_EXCLUSIVE_REACTOR = '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4';
```

**Status**: ✅ **CORRECT in our code** (you already have the right address!)

---

## ⚠️ CRITICAL BUG FOUND: Wrong Event Signature!

### Current Code Problem:
Our code is listening for:
```typescript
// WRONG EVENT - does NOT exist on PriorityOrderReactor!
const orderOpenTopic = ethers.id('OrderOpen(bytes32,address,uint256)');
```

### Correct Events for Priority Order Reactor:

From Basescan ABI (verified source code):

```solidity
// Event 1: When an order is FILLED (successfully completed)
event Fill(
  bytes32 indexed orderHash,
  address indexed filler,
  address indexed swapper,
  uint256 nonce
);

// Event 2: When ownership changes
event OwnershipTransferred(
  address indexed user,
  address indexed newOwner
);

// Event 3: When protocol fee controller changes
event ProtocolFeeControllerSet(
  address oldFeeController,
  address newFeeController
);
```

**Bottom Line**: Priority Order Reactor does **NOT emit an "OrderOpen" event**!

---

## 🔴 Why We're Finding 0 Orders

We're listening for `OrderOpen` which doesn't exist. We should be:

### Option 1: Listen for `Fill` Events (After Orders Are Filled)
```typescript
const fillTopic = ethers.id('Fill(bytes32,address,address,uint256)');
```
✅ **Pros**: Confirmed event, easy to detect
❌ **Cons**: Only see orders AFTER they're filled (too late to fill!)

### Option 2: Monitor for Input Token Transfers
```typescript
// When an order is submitted, the order signer approves tokens to Permit2
// Watch for Transfer events on USDC, ETH, etc. going TO Permit2
const transferTopic = ethers.id('Transfer(address,address,uint256)');
const permit2Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
```
✅ **Pros**: Detect pending orders before fill
❌ **Cons**: Many false positives (any transfer to Permit2)

### Option 3: Use UniswapX SDK to Parse Calldata (RECOMMENDED)
```typescript
// Monitor mempool or subscription for raw transactions to reactor
// When you see a tx to the reactor, decode it with UniswapX SDK
// This gives you full order details before execution
```
✅ **Pros**: See all orders, get full details
❌ **Cons**: Need to monitor transactions, requires SDK

### Option 4: Use UniswapX Public API or Subgraph (IF AVAILABLE)
Some networks have a public feed of pending orders. Check:
- https://api.uniswap.org (may have `/orders/open` endpoint for Base)
- Uniswap Subgraph for Base (if UniswapX subgraph exists)

---

## 📋 Complete Discovery Strategy for Base

### Phase 1: Detect Active Orders (Choose One)

**Recommended Approach**:
```typescript
// Strategy 1: Monitor transaction calldata to reactor
// Requires ethers.js v6 + transaction monitoring

async function listenForUniswapXOrders() {
  const REACTOR = '0x000000001Ec5656dcdB24D90DFa42742738De729';
  
  // Method A: Get pending transactions via WebSocket
  const wsProvider = new ethers.WebSocketProvider('wss://base-mainnet.publicnode.com');
  
  wsProvider.on('pending', async (txHash) => {
    try {
      const tx = await wsProvider.getTransaction(txHash);
      // Check if tx is to PriorityOrderReactor
      if (tx?.to?.toLowerCase() === REACTOR.toLowerCase()) {
        console.log('Found transaction to reactor:', txHash);
        console.log('Data:', tx.data);
        // TODO: Decode with @uniswap/uniswapx-sdk
      }
    } catch (err) {
      // Expected - not all txs will be available
    }
  });
}
```

**Alternative: Listen to Fill Events (only see completed orders)**:
```typescript
// Only shows orders that ALREADY FILLED
const reactor = new ethers.Contract(
  REACTOR_ADDRESS,
  ['event Fill(bytes32 indexed orderHash, address indexed filler, address indexed swapper, uint256 nonce)'],
  provider
);

reactor.on('Fill', (orderHash, filler, swapper, nonce) => {
  console.log('Order filled:', { orderHash, filler, swapper, nonce });
  // Too late - order already executed
});
```

### Phase 2: Decode Order Details

Use the UniswapX SDK:
```bash
npm install @uniswap/uniswapx-sdk@^2.1.0
```

```typescript
import { UniswapXOrderData, PriorityOrderType } from '@uniswap/uniswapx-sdk';

// Decode the transaction calldata
function decodeOrder(txData: string, txValue: bigint) {
  // TODO: Implement SDK-based decoding
  // SDK handles Priority Order specific fields:
  // - priorityFee
  // - startTime  
  // - scalingFactor
  // - mpsPerPriorityFeeWei
}
```

### Phase 3: Validate and Check Profitability

```typescript
// After decoding:
1. Verify order signature (SDK does this)
2. Check if we have adequate funds to fill
3. Calculate profit after gas
4. Submit if profitable
```

---

## 🎯 Implementation Roadmap

### Immediate (Next 30 Minutes)
- ✅ [DONE] Confirm correct reactor address for Base
- 🔴 [FIX NOW] Stop listening for non-existent `OrderOpen` event
- ⏳ Choose discovery strategy (mempool monitoring vs API vs other)

### Short Term (Next 2-4 Hours)
- Implement proper order discovery mechanism
- Add UniswapX SDK integration
- Implement order validation and decoding
- Test with real Base mempool

### Medium Term (4-24 Hours)
- Get first order detected and filled
- Collect statistics on order frequency
- Measure profitability

---

## 🚨 Current Code Issues

### File: `src/listener/uniswapXFeed.ts`

#### Issue 1: Wrong Event Signature (Line ~240)
```typescript
// WRONG - this event does not exist!
const orderOpenTopic = ethers.id('OrderOpen(bytes32,address,uint256)');

// Should be (if listening to Fill events - but these are too late):
const fillTopic = ethers.id('Fill(bytes32,address,address,uint256)');
```

#### Issue 2: No Order Decoding
```typescript
// Line ~250 - we parse logs but do nothing with them:
const logs = await provider.getLogs({...});
console.log(`Found ${logs.length} events...`);
// TODO: Actually parse and decode the logs!
return [];  // Always returns empty!
```

#### Issue 3: No UniswapX SDK Usage
We're not using the official SDK to decode orders:
```bash
npm install @uniswap/uniswapx-sdk
```

---

## 🔧 Quick Fix Options

### Option A: Quick Workaround - Listen to Fill Events
This will detect orders AFTER they're filled (not ideal but instant to implement):

```typescript
// In fetchFromReactorEvents():
const FILL_TOPIC = ethers.id('Fill(bytes32,address,address,uint256)');

const logs = await provider.getLogs({
  address: UNISWAPX_PRIORITY_REACTOR_BASE,
  topics: [FILL_TOPIC],  // CHANGE THIS
  fromBlock: latestBlock - 5000,  // Look back more blocks
  toBlock: 'latest',
});

return logs.map((log) => {
  const [orderHash, filler, swapper, nonce] = ethers.AbiCoder.defaultAbiCoder()
    .decode(['bytes32', 'address', 'address', 'uint256'], log.data);
  
  console.log('Detected filled order:', orderHash);
  // Note: Order already filled by someone else
  return null; // Still can't act on it
});
```

❌ **Problem**: We see orders AFTER they're filled by someone else

### Option B: Proper Solution - Monitor Mempool Transactions

```typescript
// Monitor pending transactions to the reactor
async function listenForPendingOrders() {
  const wsProvider = new ethers.WebSocketProvider('wss://base-mainnet.publicnode.com');
  const REACTOR = '0x000000001Ec5656dcdB24D90DFa42742738De729';
  
  // WARNING: This is noisy - may get many false positives
  wsProvider.on('pending', async (txHash) => {
    try {
      const tx = await wsProvider.getTransaction(txHash);
      if (tx?.to?.toLowerCase() !== REACTOR.toLowerCase()) return;
      
      console.log('Found order submission to reactor:', txHash);
      // TODO: Decode order with SDK
    } catch {
      // Normal - not all pending tx are accessible
    }
  });
}
```

✅ **Pros**: See orders before anyone fills them
⚠️ **Cons**: Need WebSocket, need SDK for decoding, noisy

### Option C: Use UniswapX Official API

Check if Base is supported:
```bash
curl https://api.uniswap.org/v2/orders?chainId=8453&orderStatus=open&orderType=Priority

# If it returns data -> use this!
# If 404 or 403 -> need different approach
```

---

## 📊 Debugging Checklist

- [ ] Confirm we have the correct reactor address
- [ ] Check if Priority Order Reactor even emits events
- [ ] Verify Base has sufficient UniswapX volume
- [ ] Check if UniswapX API supports Base
- [ ] Test mempool monitoring with a simple example
- [ ] Validate SDK decoding works locally

---

## 🎓 Learning Resources

1. **UniswapX Docs - Fillers Guide**
   https://docs.uniswap.org/contracts/uniswapx/fillers/filleroverview

2. **UniswapX GitHub Repository**
   https://github.com/Uniswap/UniswapX
   - Look at `/src/reactors/` for reactor implementations
   - Look at `/test/` for usage examples

3. **Priority Order Reactor Docs**
   https://docs.uniswap.org/contracts/uniswapx/auctiontypes

4. **UniswapX SDK**
   https://github.com/Uniswap/uniswapx-sdk
   - v2.1.0+ has Priority Order support

---

## ❓ Fundamental Questions We Need to Answer

1. **Does Base have sufficient UniswapX volume?**
   - If yes → proceed with proper integration
   - If no → consider pivoting to Ethereum or Arbitrum

2. **What's the best discovery method for Base?**
   - API endpoint?
   - Mempool monitoring?
   - Event listening?
   - Subgraph queries?

3. **Can we access premium RPCs?**
   - Public RPC may not support all features
   - Alchemy/Infura/QuickNode needed for WebSocket access

---

## Next Steps

### Immediate Action:
1. **Test the UniswapX API**:
   ```bash
   curl -v "https://api.uniswap.org/v2/orders?chainId=8453&orderStatus=open&orderType=Priority" 2>&1 | head -50
   ```
   
   If this returns orders → use the API ✅
   If this returns 403/404 → need different approach ❌

2. **If API doesn't work, test Fill events** (fallback):
   ```bash
   npm run build
   # Modify fetchFromReactorEvents to use Fill topic
   npm start
   # Monitor for 24 hours
   ```

3. **If no orders found after 24h**:
   - Base might not have sufficient UniswapX volume
   - Consider Ethereum mainnet instead
   - Or implement mempool monitoring

---

**Status**: 🔴 **CRITICAL** - Fix event signature ASAP
**Impact**: Currently finding 0 orders (partly because we're listening for wrong event)
**ETA to Fix**: 15 minutes to implement quick fix, 2-4 hours for proper solution
