# Testing on Optimism Network

This guide explains how to test your intent solver bot on Optimism (testnet or mainnet).

## Network Options

### **Option 1: Optimism Sepolia Testnet (Recommended for Testing)**
- **Network:** Optimism Sepolia (L2 testnet)
- **Chain ID:** 11155420
- **RPC Endpoint:** https://sepolia.optimism.io
- **Explorer:** https://sepolia-optimism.etherscan.io
- **Cost:** FREE (testnet gas, request free OP-ETH from faucet)
- **Best for:** Safe testing, learning, development

### **Option 2: Optimism Mainnet**
- **Network:** Optimism (L2 production)
- **Chain ID:** 10
- **RPC Endpoint:** https://mainnet.optimism.io
- **Explorer:** https://optimismscan.io
- **Cost:** Real gas fees (see cost section below)
- **Best for:** Production deployment

## Setup: Testnet (FREE)

### Step 1: Get Testnet ETH
1. Go to https://www.alchemy.com/faucets/optimism-sepolia
2. Connect your wallet
3. Get free Sepolia ETH

### Step 2: Bridge to Optimism Sepolia
1. Go to https://app.optimism.io/bridge
2. Select "Optimism Sepolia" network
3. Bridge your testnet ETH (costs 0 ETH on testnet)

### Step 3: Update `.env`
```bash
# .env for Optimism Sepolia Testnet
MODE=live
ENABLE_LIVE=false  # Set to true only after thorough testing
RPC_URL=https://sepolia.optimism.io
CHAIN_ID=11155420
PRIVATE_KEY=0xyour_private_key_here
FORK_URL=https://sepolia.optimism.io
```

### Step 4: Get a Wallet with Private Key
Generate a test wallet:
```bash
# Using ethers.js
npm run dev  # This will generate a sample wallet if needed
```

Or import an existing wallet to your environment.

## Setup: Mainnet (Real Costs)

### Step 1: Acquire Mainnet ETH
- Buy ETH on an exchange
- Or receive from someone with existing mainnet ETH

### Step 2: Bridge to Optimism
1. Go to https://app.optimism.io/bridge
2. Select "Optimism" network
3. Bridge your ETH (costs ETH in gas)

### Step 3: Update `.env`
```bash
# .env for Optimism Mainnet
MODE=live
ENABLE_LIVE=true  # REAL TRANSACTIONS
RPC_URL=https://mainnet.optimism.io
CHAIN_ID=10
PRIVATE_KEY=0xyour_mainnet_private_key
FORK_URL=https://mainnet.optimism.io
```

## Running the Bot

### Test Mode (No Real Transactions)
```bash
# Sepolia testnet, dry-run only
MODE=live ENABLE_LIVE=false npm run demo
```

### Live Mode (Real Transactions on Testnet)
```bash
# Sepolia testnet with real submissions
MODE=live ENABLE_LIVE=true RPC_URL=https://sepolia.optimism.io npm start
```

### Live Mode (Real Transactions on Mainnet)
```bash
# CAUTION: This submits real transactions and incurs real gas costs
MODE=live ENABLE_LIVE=true RPC_URL=https://mainnet.optimism.io npm start
```

## Cost Analysis

### Optimism Gas Costs

**Note:** Optimism L2 is significantly cheaper than Ethereum L1!

#### Typical Transaction Costs (Optimism Sepolia Testnet)
- Settlement transaction: **0 OP-ETH** (testnet free)
- State root posting: **Included in gas** (OP handles L1 posting)

#### Typical Transaction Costs (Optimism Mainnet)
- Settlement transaction: **$0.10 - $0.50**
- Gas price: **0.01 - 1 Gwei** (vs Ethereum 20-50+ Gwei)
- Gas used: **300,000 - 500,000 gas** per settlement

**Breakdown for a single settlement:**

```
Gas Limit:        400,000 units
Gas Price:        0.1 Gwei (normal market)
Base Cost (L2):   400,000 × 0.1 = 40,000 Gwei = 0.00004 ETH ≈ $0.10

With L1 posting:  0.00004 ETH + L1 fees (amortized) ≈ $0.15-0.20 total

High gas market:
Gas Price:        1 Gwei (high market)
Base Cost (L2):   400,000 × 1 = 400,000 Gwei = 0.0004 ETH ≈ $1.00
```

### Cost Comparison: L1 vs L2

| Cost Component | Ethereum L1 | Optimism L2 | Savings |
|---|---|---|---|
| Gas price (normal) | 20-30 Gwei | 0.01-0.1 Gwei | **200-3000x** |
| Settlement tx | $5-50 | $0.10-1 | **50-500x** |
| 100 settlements/day | $500-5000 | $10-100 | **50-500x** |

### Monthly Cost Estimate (Mainnet)

**Scenario:** Intent matching bot running 24/7, settling 10 profitable pairs per hour

```
Settlements/hour:    10
Settlements/day:     240
Settlements/month:   7,200

Cost per settlement: $0.20 (average)
Total monthly cost:  7,200 × $0.20 = $1,440

Plus:
- RPC costs:         $50-200/month (if using paid RPCs)
- Infrastructure:    $100-500/month (server/database)
Total monthly ops:   ~$1,600-2,200
```

### Ways to Reduce Costs

1. **Batch settlements:** Combine multiple intents into single tx
   - Savings: **30-40%**
   
2. **Off-peak submission:** Submit during low-gas periods
   - Savings: **20-50%**
   
3. **Use intent aggregation:** Collect intents over time, settle in batches
   - Savings: **50-70%**
   
4. **MEV-aware routing:** Avoid sandwich attacks, reduce failed attempts
   - Savings: **10-30%**

## Implementation Tasks

To submit real transactions on Optimism, you need to:

### 1. Implement Contract Interfaces
- In `src/submitter/submitter.ts`, uncomment and implement:
  - Settlement contract ABI and address
  - Transaction construction with real gas estimation
  - Error handling and retry logic

### 2. Test on Sepolia First
- Deploy mock contracts to Sepolia
- Run integration tests with real settlement calls
- Verify gas estimation accuracy
- Monitor for failed transactions

### 3. Add Safety Checks
- Validate all contract addresses
- Check ENABLE_LIVE=true before mainnet
- Add profit threshold checks
- Implement transaction monitoring

### 4. Monitor Performance
```bash
# Check bot logs
tail -f ./logs/bot.log

# Monitor settlements on-chain
# Visit: https://optimismscan.io and search your address
```

## Troubleshooting

### RPC Errors
```bash
# If you get rate limits, use Alchemy or Infura with API keys
RPC_URL=https://opt-mainnet.g.alchemy.com/v2/YOUR_API_KEY npm start
```

### Transaction Reverts
- Check gas estimation accuracy
- Verify contract addresses
- Ensure you have sufficient balance
- Check deadline/expiry of intents

### High Gas Usage
- Profile the settlement function
- Consider batching multiple intents
- Implement gas optimization

## Resources

- **Optimism Docs:** https://docs.optimism.io
- **Sepolia Faucet:** https://www.alchemy.com/faucets/optimism-sepolia
- **Bridge:** https://app.optimism.io/bridge
- **Explorer:** https://optimismscan.io
- **Gas Oracle:** https://optimism.io/gas-tracker

## Safety Checklist

Before running in live mode on mainnet:

- [ ] ENABLE_LIVE=true only after testing on testnet
- [ ] Private key stored securely (use environment variables)
- [ ] All contract addresses verified
- [ ] Gas estimation tested and validated
- [ ] Profit threshold set appropriately
- [ ] Error handling and monitoring in place
- [ ] Database backups configured
- [ ] RPC failover configured
- [ ] Withdrawal mechanism implemented
- [ ] 24/7 monitoring/alerting set up

---

**Questions?** Check DEVELOPMENT.md for implementation details.
