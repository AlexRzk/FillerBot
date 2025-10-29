# 🚀 ACTION PLAN: Fix Order Detection

## Current Status: CODE ENHANCED WITH DIAGNOSTICS

I've added extensive logging to help you see exactly where orders are getting lost. The code will now show:

1. Every pending transaction detected
2. Which ones go to the reactor
3. What the decoded order looks like
4. What Intent is created from it

---

## Step 1: Deploy & Test With Diagnostics

### Command to Run
```bash
npm run build
npm run dev
```

### What to Look For in Logs

#### If WebSocket works:
```
[info] ✅ Connected to chain: 8453 (base)
[info] Subscribing to pending transactions...
```

#### When a transaction is found:
```
[debug] Pending tx 0xabcd1234... to: 0x00000000...
[info] 🔍 Found transaction to reactor: 0xabcd1234...
[info] TX Data length: 548 bytes
[info] TX Data (first 100 chars): 0x1a5eedf...
```

#### When decoding happens:
```
[debug] Decoded order fields: {
  orderHash: '0xabcd12...',
  swapper: '0x1234...',
  inputToken: '0x833...', ← Should be REAL address
  outputToken: '0x4cb...', ← Should be REAL address
  inputAmount: '1000000000000000000', ← Should be NON-ZERO
  outputAmount: '2000000000000000000', ← Should be NON-ZERO
  deadline: '1234567890'
}
```

#### If decoding fails:
```
[warn] Could not decode order from transaction data
[warn] Decode returned null for tx: 0xabcd1234. Check decoder implementation.
```

**This is the critical message!** It means the decoder stub is returning null.

---

## Step 2: Diagnose the Exact Problem

### Scenario A: "No pending transactions logged"
```
Problem: WebSocket connection isn't receiving pending events
Cause: 
  1. WebSocket RPC URL blocked or invalid
  2. Public node doesn't emit pending events (some don't)
  3. Network connectivity issue

Solution:
  1. Try a different WebSocket provider (Alchemy or Infura)
  2. Test WebSocket connection manually:
     wscat -c wss://base-mainnet.publicnode.com
  3. Check firewall/proxy rules
```

### Scenario B: "Pending transactions logged, but none match reactor"
```
Problem: Transactions are detected but none go to the reactor
Possible causes:
  1. No orders actually being placed on Base (duh)
  2. Orders placed on different chain
  3. Reactor address hardcoded wrong

Debug:
  - Check if ADDRESS is correct: 0x000000001Ec5656dcdB24D90DFa42742738De729
  - Try on Base testnet instead
  - Manually place a test order
```

### Scenario C: "Reactor transactions logged, but decode fails"
```
Problem: Found reactor transaction but decodePriorityOrderCalldata() returns null
Root cause: Decoder stub is incomplete

Logs will show:
[info] 🔍 Found transaction to reactor: 0x...
[warn] Could not decode order from transaction data
[warn] Decode returned null for tx: 0x...

This means: The decoder function returned null, so the order is skipped.

Next action: Implement proper decoding (see Step 3 below)
```

### Scenario D: "Decode succeeds but amounts are ZERO"
```
Problem: Decoder returns real addresses but zero amounts
Log will show:
[debug] Decoded order fields: {
  inputToken: '0x833507973f0b9a...',  ← Real address ✅
  outputToken: '0x4cb9a7ae3362ad...',  ← Real address ✅
  inputAmount: '0',  ← ZERO ❌
  outputAmount: '0',  ← ZERO ❌
}

This is the decoder stub! It's only half-working.

Next action: Implement proper field extraction in decoder (see Step 3)
```

---

## Step 3: Implement Proper Order Decoding

This is the REAL work. The decoder currently returns placeholder data. You need to:

### 3a. Find the PriorityOrder Struct ABI

Option 1: From UniswapX SDK
```bash
npm view @uniswap/uniswapx-sdk
```

Then look for the PriorityOrder struct definition.

Option 2: From Basescan
1. Go to: https://basescan.org/address/0x000000001Ec5656dcdB24D90DFa42742738De729
2. Click "Contract" tab
3. Find the struct definitions (usually at the top of the ABI)

Option 3: Look at transaction examples
1. Go to Basescan
2. Find a transaction that called the reactor
3. Click "Decode Input" to see the structure

### 3b. Implement Proper Decoding

Once you have the struct, it'll look something like:

```solidity
struct PriorityOrder {
    address swapper;
    address nonce;
    uint256 deadline;
    address inputToken;
    address outputToken;
    uint256 inputAmount;
    uint256 outputAmount;
    uint256 priorityFee;
    // ... other fields
}
```

Then implement the decoder:

```typescript
export function decodePriorityOrderCalldata(
  txData: string,
  _txValue: bigint = BigInt(0)
): DecodedPriorityOrder | null {
  try {
    if (!txData || txData === '0x') return null;

    // Function selector for execute() - find the real one
    const selector = txData.slice(0, 10);  // e.g., '0x1a5eedf2'
    
    // Prepare for decoding
    const encodedParams = '0x' + txData.slice(10);
    
    // Types based on the actual struct
    const types = [
      'address',   // swapper
      'uint256',   // nonce
      'uint256',   // deadline
      'address',   // inputToken
      'address',   // outputToken
      'uint256',   // inputAmount
      'uint256',   // outputAmount
      'uint256',   // priorityFee
      // ... add other fields from actual struct
    ];
    
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      types,
      encodedParams
    );
    
    // Map to our interface
    const order: DecodedPriorityOrder = {
      orderHash: ethers.keccak256(txData),
      swapper: decoded[0],
      nonce: BigInt(decoded[1]),
      deadline: BigInt(decoded[2]),
      inputToken: decoded[3],
      outputToken: decoded[4],
      inputAmount: BigInt(decoded[5]),
      outputAmount: BigInt(decoded[6]),
      priorityFee: BigInt(decoded[7]),
      rawData: txData,
    };
    
    return order;
    
  } catch (error: any) {
    console.debug('[debug] Failed to decode:', error.message);
    return null;
  }
}
```

### 3c: Test the Decoder

Add this test to verify:
```typescript
// Test with a real transaction from Basescan
const realTxData = '0x1a5eedf2...'; // Copy from a Base transaction
const decoded = decodePriorityOrderCalldata(realTxData);

console.log('Decoded:', decoded);
// Should NOT show all zeros!
```

---

## Step 4: Expected Success Criteria

After fixes, you should see:

```
[info] ✅ Connected to chain: 8453 (base)
[info] Subscribing to pending transactions...

(Place a test order on Base)

[debug] Pending tx 0xabcd1234... to: 0x00000000...
[info] 🔍 Found transaction to reactor: 0xabcd1234...
[info] TX Data length: 548 bytes
[debug] Decoded order fields: {
  orderHash: '0x7823...',
  swapper: '0x8b42...',
  inputToken: '0x833507973f0b9a1...',  ← REAL token ✅
  outputToken: '0x4cb9a7ae3362ad...',  ← REAL token ✅
  inputAmount: '1000000000000000000',  ← 1 USDC ✅
  outputAmount: '2000000000000000000',  ← 2 USDT minimum ✅
  deadline: '1729345678'
}
[info] ✅ New pending order detected: 0xabcd1234... from 0x8b42...
[info] Order: 1000000000000000000 0x833507... → 2000000000000000000 0x4cb9a7...
[info] Total pending orders: 1
[info] Created Intent with: sellAmount=1000000000000000000, buyAmount=2000000000000000000
```

Then the matcher/filler processes the order!

---

## Testing Sequence

### Phase 1: Setup (10 min)
```
1. Run: npm run build
2. Verify no compilation errors
3. Run: npm run dev
4. Check logs show WebSocket connection
```

### Phase 2: Diagnostics (5 min)
```
1. Place a test order on Base (or testnet)
2. Watch for logs showing order detection
3. If you see "Could not decode", go to Step 3
4. If decode works but amounts are zero, fix decoder struct
```

### Phase 3: Validation (5 min)
```
1. Verify decoded amounts are NON-ZERO
2. Verify token addresses are real (not 0x0000...)
3. Verify Intent is created with real amounts
4. Check matcher processes the order
```

---

## Where To Find Issues

| Symptom | File | Line | Fix |
|---------|------|------|-----|
| No pending events | realFeed.ts | ~70 | Check WebSocket URL |
| Decoder returns null | uniswapxDecoder.ts | 50-95 | Implement decoding |
| Amounts are zero | uniswapxDecoder.ts | 88-90 | Extract from calldata |
| Invalid tokens | uniswapxDecoder.ts | 86-87 | Decode from calldata |
| WS connection dies | mempoolOrderListener.ts | 76+ | Already fixed |

---

## Quick Commands Reference

```bash
# Build and test
npm run build
npm run dev

# Check for TypeScript errors
npm run build

# View logs with grep
npm run dev | grep -i "order\|error\|warn"

# Test WebSocket connection
wscat -c wss://base-mainnet.publicnode.com
```

---

## Summary

**What I Added:**
1. ✅ Enhanced logging at every step
2. ✅ WebSocket error handlers
3. ✅ Decoded order field logging
4. ✅ Intent amount logging
5. ✅ Transaction data inspection

**What You Need To Do:**
1. ⏳ Run the code with diagnostics
2. ⏳ Share the logs showing where orders get lost
3. ⏳ Implement proper decoder based on actual struct
4. ⏳ Test end-to-end with real orders

**Timeline:**
- Phase 1 (Setup): 10 minutes
- Phase 2 (Diagnose): 5 minutes  
- Phase 3 (Fix): 30-60 minutes (depends on complexity)
- Phase 4 (Validate): 5-10 minutes

---

## Next: Run the Diagnostics

```bash
npm run build
npm run dev
```

Watch the logs carefully. When you place a test order on Base, share the output with the issue. That will show exactly where the problem is!
