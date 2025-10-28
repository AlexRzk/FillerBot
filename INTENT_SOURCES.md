# Intent Sources for Optimism Mainnet

This document tracks available intent protocols and APIs for fetching real swap intents on Optimism.

## 🎯 Primary Target: UniswapX

**Status**: Active on Optimism  
**Type**: Dutch auction intent protocol  
**Priority**: HIGH (best source for OP intents)

### Contract Addresses (Optimism Mainnet)
- **V2 Reactor (Dutch Orders)**: `0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4`
- **Exclusive Dutch Reactor**: TBD (check if deployed)

### Data Access Methods

#### 1. Direct Event Monitoring (RECOMMENDED)
- **Method**: Query `Open` events from reactor contract
- **Reliability**: High (directly from chain)
- **Latency**: Real-time (block-level)
- **Implementation**: Use ethers.js `provider.getLogs()`

**Event Signatures to Monitor**:
```solidity
event Open(bytes32 indexed orderHash, address indexed swapper, uint256 nonce);
event Fill(bytes32 indexed orderHash, address indexed filler, uint256 swapAmount);
```

#### 2. UniswapX API
- **Endpoint**: Unknown if public API exists for Optimism
- **Status**: Needs research
- **Action**: Check Uniswap Labs documentation or contact team

#### 3. The Graph Subgraph
- **Status**: May not exist for Optimism UniswapX
- **Alternative**: Could deploy custom subgraph

### Implementation Notes
- Orders have **exclusivity periods** (first 1-2 blocks for exclusive filler)
- Dutch auction: price improves over time until filled
- Need to decode order data from contract calls or events
- Must check if we're the exclusive filler before attempting to fill

### Resources
- Docs: https://docs.uniswap.org/contracts/uniswapx
- Deployments: https://docs.uniswap.org/contracts/uniswapx/deployments
- SDK: @uniswap/uniswapx-sdk

---

## 🔍 Secondary Sources

### 1inch Fusion
**Status**: Research needed  
**Supports OP**: Check if deployed on Optimism

- **API**: https://api.1inch.dev/fusion
- **Requires**: API key (sign up at portal.1inch.dev)
- **Type**: Limit orders + MEV protection

### 0x Protocol RFQ
**Status**: Research needed  
**Supports OP**: Check if deployed on Optimism

- **API**: https://api.0x.org/swap/v1/rfq
- **Type**: Request-for-quote system
- **Requires**: Potentially needs market maker registration

### Across Protocol
**Status**: Active on Optimism  
**Type**: Cross-chain bridge intents (not swaps)

- **Note**: Different use case (bridging, not swapping)
- **Could be useful**: If we want to fill bridge intents

---

## ❌ Sources That Don't Work

### CoW Protocol
- **Status**: NOT available on Optimism
- **Supports**: Ethereum mainnet, Gnosis Chain only
- **API Response**: 405 Method Not Allowed
- **Conclusion**: Skip this source for OP

### Uniswap V3 Subgraph (The Graph)
- **Status**: Endpoint deprecated/removed
- **Error**: "This endpoint has been removed"
- **Conclusion**: Cannot use for intent data

### MEV Share Pool
- **Status**: Network failures
- **Supports**: Ethereum mainnet primarily
- **Conclusion**: Likely not available for Optimism

---

## 🛠️ Next Steps

### Immediate (Current Sprint)
1. ✅ Add UniswapX feed implementation
2. 🔄 Test event monitoring from V2 Reactor
3. 🔄 Decode order data from events
4. ⏳ Parse Dutch auction parameters (decay curve)
5. ⏳ Implement exclusivity window checks

### Short Term
1. Research 1inch Fusion API for Optimism
2. Check if 0x RFQ supports Optimism
3. Consider deploying custom subgraph for UniswapX
4. Add order validation and signature verification

### Long Term
1. Support multiple intent protocols (UniswapX, 1inch, 0x)
2. Build aggregator that prioritizes by profitability
3. Monitor multiple reactors (V2, Exclusive, future versions)
4. Add cross-chain intent support (Across, other bridges)

---

## 📊 Current Implementation Status

| Source | Implementation | Working | Priority |
|--------|---------------|---------|----------|
| UniswapX Events | ✅ Partial | 🔄 Testing | HIGH |
| UniswapX API | ❌ Unknown endpoint | ❌ No | MEDIUM |
| UniswapX Subgraph | ❌ Doesn't exist | ❌ No | LOW |
| CoW Protocol | ✅ Complete | ❌ No OP support | SKIP |
| 1inch Fusion | ❌ Not started | ❓ Unknown | MEDIUM |
| 0x RFQ | ❌ Not started | ❓ Unknown | MEDIUM |
| MEV pools | ✅ Complete | ❌ Network errors | LOW |

---

## 💡 Important Discoveries

1. **UniswapX is THE primary source** for Optimism intent-based swaps
2. **CoW Protocol doesn't support Optimism** - wasted effort trying to integrate
3. **Direct event monitoring is most reliable** - APIs may not exist or be public
4. **Need UniswapX SDK** to properly decode orders and validate signatures
5. **Exclusivity periods are critical** - must respect or face reverts

## 🔐 Safety Considerations

Before filling any UniswapX order:
- ✅ Verify order signature (use @uniswap/uniswapx-sdk)
- ✅ Check exclusivity deadline (are we the exclusive filler?)
- ✅ Validate Dutch auction hasn't expired
- ✅ Ensure sufficient output amount after decay
- ✅ Check maker has sufficient balance and approval
- ✅ Simulate fill transaction before submitting
- ✅ Monitor for competing fillers (front-running risk)

## 📚 Additional Resources

- UniswapX GitHub: https://github.com/Uniswap/UniswapX
- Order validation: Check signature recovery and nonce
- Reactor ABI: Get from Etherscan or SDK
- Example fillers: Study existing UniswapX filler bots
