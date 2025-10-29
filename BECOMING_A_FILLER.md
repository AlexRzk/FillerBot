# Becoming a Filler: Complete Guide

## TL;DR - What You Need

To become a filler on Base mainnet, you need:

1. **Funded Wallet** - ETH for gas + tokens to fill orders (amount depends on order size)
2. **Approval Contract** - Register as a filler with UniswapX Priority Reactor
3. **Order Detection** - Bot must find profitable orders (✅ WORKING)
4. **Order Filling** - Execute fills with proper accounting (⚠️ NEEDS IMPLEMENTATION)
5. **Profitability** - Gains > gas costs + slippage

---

## Current Bot Status

### ✅ What's Working

- **Order Detection**: Bot detects pending orders in Base mainnet mempool via WebSocket
- **Order Logging**: Filler/swapper addresses correctly formatted and logged
- **Network Connection**: Successfully connected to Alchemy's Ethereum nodes
- **Monitoring**: Watching real Fill events on-chain
- **Safety Systems**: Price oracle + circuit breaker implemented

### ⚠️ What Needs Implementation

1. **Order Filling Contract Integration** - `submitPlan()` is stubbed
2. **Settlement Contract ABI** - Need actual UniswapX settlement interface
3. **Gas Simulation** - Current estimations are placeholders
4. **Profit Calculation** - Uses simplified math, needs real token prices
5. **Live Mode Submission** - Transaction construction not implemented

---

## Step 1: Fund Your Wallet

### Option A: Test on Base Sepolia (Recommended First)

1. Get test ETH from faucet:
   - Alchemy: https://www.alchemy.com/faucets/base-sepolia
   - Base: https://www.base.org/docs/tools/network-faucets

2. Get test tokens (USDC, WETH, etc):
   - Faucets: https://sepoliafaucet.com/

### Option B: Production (Base Mainnet)

1. Send real ETH to your wallet address
2. Swap for common trading pairs (USDC, WETH, etc) via DEX
3. **Start small** - use 0.1 ETH for initial testing

---

## Step 2: Register as a Filler

### On Base Mainnet

The UniswapX Priority Reactor address: `0x000000001Ec5656dcdB24D90DFa42742738De729`

**Option 1: Simple Registration** (if available)
```bash
# Call reactor contract with your wallet address
# This registers you as an approved filler
```

**Option 2: Relayer-based** (most common)
- Become a relayer/filler through official UniswapX interface
- Check: https://uniswap.org or UniswapX docs

**Option 3: Self-execution**
- You don't technically need to "register" if you own the intents
- Test by executing trades yourself

---

## Step 3: Enable Live Mode (When Ready)

Currently, your bot is in **LOCAL MODE** (safe, no real transactions).

### To Submit Real Fills:

1. **Update `.env`**:
```bash
MODE=live
ENABLE_LIVE=true
CHAIN_ID=8453  # Base mainnet
RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY
PRIVATE_KEY=0x... # Your funded wallet private key
```

2. **Verify Safety**:
   - ✅ Circuit breaker is enabled
   - ✅ Gas price limits enforced
   - ✅ Min profit threshold set ($0.50 default)
   - ✅ Max position size set ($50 default)

3. **Start Bot in Live Mode**:
```bash
npm run build
npm run dev
```

---

## Step 4: Implement Order Filling

### Current Status

The `submitPlan()` function in `src/submitter/submitter.ts` is **stubbed** (mock implementation).

### What Needs to Happen

When a profitable order pair is found, your bot needs to:

1. **Construct Settlement Transaction**:
```typescript
// Pseudo-code - needs implementation
const settlementTx = {
  to: SETTLEMENT_CONTRACT,
  data: settlement.interface.encodeFunctionData('settle', [
    intentA,      // First order
    intentB,      // Matching order
    fillData,     // Execution details
  ]),
  gas: estimatedGas,
  gasPrice: currentGasPrice,
};
```

2. **Send via Signer**:
```typescript
const signer = getSigner(); // Your private key
const txResponse = await signer.sendTransaction(settlementTx);
await txResponse.wait(1); // Wait for confirmation
```

3. **Profit = Input Received - Output Spent - Gas Costs**:
```
Profit = (tokensBought * priceFromAMM) - (tokensSold * currentMarketPrice) - gasSpent
```

### Implementation Checklist

- [ ] Get UniswapX settlement contract ABI
- [ ] Create `settlementContract.ts` with contract interface
- [ ] Implement `encodeSettlementCall()` function
- [ ] Add gas estimation with current Alchemy RPC data
- [ ] Test with `MODE=local` first
- [ ] Test on Base Sepolia testnet
- [ ] Deploy to Base mainnet

---

## Step 5: Common Issues & Solutions

### Issue 1: "No Orders Detected"
- ✅ We fixed this - bot now detects mempool orders
- Watch logs for: `✅ New pending order detected`

### Issue 2: "0 Profitable Orders"
**Possible causes:**
- Gas costs too high relative to order spreads
- Decoder returning zeros (check logs for "Potential gain: +0")
- Order spreads too small

**Solutions:**
- Increase `MIN_PROFIT_THRESHOLD` slowly (start at $0.50)
- Filter for larger orders (typically $1000+)
- Monitor gas prices - fill when gas is cheap

### Issue 3: "Transaction Failed"
**Common reasons:**
- Insufficient balance for order fill
- Slippage tolerance exceeded
- Account not registered as filler
- Settlement contract interaction error

**Debug:**
1. Check wallet balance: `ethers.provider.getBalance(yourAddress)`
2. Verify approvals: Check token allowances
3. Check logs for error details

### Issue 4: "Filler Address Shows 0x00000000"
- ✅ **FIXED** - Now shows proper checksummed addresses
- If still happening, check for old compiled files: `rm -rf dist/ && npm run build`

---

## Step 6: Profitability Math

### Simple Example

```
Order Pair Found:
  Alice: 1 ETH → 1600 USDC (slippage: 0.5%)
  Bob:   1610 USDC → 1.01 ETH (slippage: 0.5%)

Execution:
  1. Take Alice's 1 ETH
  2. Swap via AMM: 1 ETH → 1600 USDC
  3. Give Bob 1610 USDC from pool → get 1.01 ETH
  4. Give Alice 1600 USDC
  
Result:
  Gain: 1.01 - 1 = 0.01 ETH ≈ $20
  Gas Cost: ~0.01 ETH @ $3k = $30
  
Profit: $20 - $30 = -$10 ❌ NOT PROFITABLE
```

**Key insight**: You need 2-5% spreads to be profitable after gas!

---

## Step 7: Monitoring & Metrics

### Key Logs to Watch

```
[info] 📊 Cycle #1: Analyzing 5 pending intents
[info] ✅ Found 2 candidate pairs for matching
[info] 💰 Top plan profit: 0.00150000 ETH
[info] Found 1 profitable plans (min threshold: 500000000000000)
```

### Metrics Dashboard

Track in your monitoring system:
- **Orders Detected**: Should see dozens per minute on Base
- **Pairs Matched**: Look for patterns (ETH/USDC, WETH/DAI)
- **Profitable Trades**: Depends on spread quality
- **Win Rate**: Should be 60-80% if threshold is set correctly
- **Gas Costs**: Monitor Base L2 gas prices

---

## Step 8: Production Checklist

Before going live on Base mainnet:

- [ ] **Testing Phase 1**: Run on Base Sepolia with $100 USDC
- [ ] **Testing Phase 2**: Run on Base mainnet with $1000 (1-2 hours)
- [ ] **Safety Checks**:
  - [ ] Circuit breaker limits are reasonable
  - [ ] Min profit threshold covers gas
  - [ ] Max position size is appropriate
  - [ ] Wallet has at least 0.5 ETH for gas
- [ ] **Monitoring**:
  - [ ] Logs stored to file (for debugging)
  - [ ] Alert system for failed fills
  - [ ] Dashboard for real-time P&L
- [ ] **Compliance**:
  - [ ] Terms of service reviewed
  - [ ] Tax implications understood
  - [ ] Slashing risks assessed

---

## Next Steps

### Immediate (This Week)
1. ✅ Get order detection working (DONE)
2. ⏳ Fix address formatting (DONE)
3. ⏳ Implement `submitPlan()` to actually submit fills
4. ⏳ Test on Base Sepolia with small amounts

### Short-term (This Month)
1. Add real settlement contract integration
2. Implement Flashbots or MEV-Blocker protection
3. Add database persistence for historical trades
4. Create monitoring dashboard

### Medium-term (This Quarter)
1. Scale to multiple token pairs
2. Add MEV protection for live orders
3. Implement advanced matching algorithms
4. Deploy to production clusters

---

## Resources

- **UniswapX Docs**: https://uniswap.org/blog/uniswapx
- **Base Docs**: https://docs.base.org
- **Alchemy API**: https://www.alchemy.com/docs
- **ethers.js**: https://docs.ethers.org
- **Foundry**: https://book.getfoundry.sh

---

## FAQ

**Q: Do I need a lot of capital to start?**
A: Start with $100-500 on testnet, then 0.5-1 ETH on mainnet. As order volumes increase, you'll need more.

**Q: How much can I make?**
A: Depends on spreads. Typical MEV: $5-50 per profitable trade. With good spreads, $1000-10000/day is possible.

**Q: Is my bot fast enough?**
A: Speed is competitive. The mempool listener adds ~50-200ms latency (acceptable for most orders).

**Q: What about competition?**
A: Many bots compete. Differentiation through: better spreads, faster execution, lower gas usage.

**Q: Is this legal?**
A: Yes, MEV filling is a core part of blockchain. But check local tax laws and exchange regulations.

---

## Support

Questions? Check logs first:
```bash
# Last 100 lines of bot output
npm run dev 2>&1 | tail -100

# Check for errors
grep "\[error\]" bot.log

# Check gas prices
grep "gasPrice\|gasEstimate" bot.log
```
