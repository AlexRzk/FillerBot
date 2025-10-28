# Intent Solver - Quick Reference Card

## Installation & Setup (Copy-Paste)

```bash
# 1. Clone/Enter directory
cd intent-solver

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.example .env

# 4. Start local node (Terminal 1)
bash scripts/start-local.sh          # macOS/Linux
# OR
scripts\start-local.bat               # Windows

# 5. Run demo (Terminal 2)
npm run demo
```

---

## Environment Variables Quick Reference

```bash
MODE=local                           # ALWAYS use 'local' unless you know what you're doing
ENABLE_LIVE=false                    # NEVER set to true until live deployment is ready
RPC_URL=http://127.0.0.1:8545       # Local Anvil node
PRIVATE_KEY=0xaaaa...                # Test key (change for live)
DATABASE_PATH=./data/bot.db         # SQLite file location
MIN_PROFIT_THRESHOLD=1000000000000000  # Min profit to execute (wei)
LOG_LEVEL=info                       # Set to 'debug' for verbose logs
```

---

## Common Commands

| Command | What It Does |
|---------|-----------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run with live recompilation |
| `npm run demo` | Run 10-second demo |
| `npm run test` | Run all tests |
| `npm run lint` | Check code style |
| `npm run format` | Auto-format code |
| `bash scripts/start-local.sh` | Start Anvil + deploy |

---

## Architecture in 30 Seconds

```
Intents → Listener → Database
                        ↓
                    Matcher (find pairs)
                        ↓
                    Planner (build plan)
                        ↓
                    Simulator (test)
                        ↓
                    Submitter (send tx)
                        ↓
                    Monitor (record)
```

---

## Key Files to Edit

| File | What's There | What to Change |
|------|-----------|---------------|
| `src/submitter/submitter.ts` | Mock submission | Uncomment real contract calls |
| `src/listener/apiListener.ts` | Stub | Add CoW/1inch API integration |
| `src/matcher/matcher.ts` | Working | Optimize algorithm for scale |
| `.env` | Configuration | Set your RPC/key for live |
| `contracts/MockAMM.sol` | Working | Use real AMM for production |

---

## Testing Workflow

```bash
# 1. Write test
cat > test/unit/mytest.test.ts << 'EOF'
it('should do something', () => {
  expect(true).toBe(true);
});
EOF

# 2. Run test
npm run test -- mytest.test.ts

# 3. Watch mode while developing
npm run test -- --watch
```

---

## Database Queries

```bash
# Open database
sqlite3 ./data/bot.db

# View all intents
SELECT id, status, sellAmount FROM intents;

# View recent runs
SELECT id, actualProfit, createdAt FROM runs ORDER BY createdAt DESC LIMIT 10;

# Calculate total profit
SELECT SUM(actualProfit) FROM runs WHERE actualProfit > 0;

# Exit
.quit
```

---

## Debugging Checklist

- [ ] Check `.env` has correct MODE and RPC_URL
- [ ] Verify `npm install` completed without errors
- [ ] Confirm Anvil is running: `curl http://127.0.0.1:8545`
- [ ] Check database exists: `ls -la ./data/bot.db`
- [ ] Enable debug logs: `LOG_LEVEL=debug npm run demo`
- [ ] Inspect database: `sqlite3 ./data/bot.db`
- [ ] Review logs: `cat logs/app.log | grep ERROR`

---

## File Navigation

```
You are here: intent-solver/

├─ Want to understand flow?
│  └─ Read: src/index.ts → src/monitor/monitor.ts

├─ Want to add a feature?
│  └─ Start: src/listener/apiListener.ts (add CoW API)
│  └─ Or: src/submitter/submitter.ts (real submission)

├─ Want to optimize?
│  └─ Check: src/matcher/matcher.ts (O(n²) → hash map)

├─ Want to extend to live?
│  ├─ Step 1: DEVELOPMENT.md → "Real Settlement"
│  ├─ Step 2: DEVELOPMENT.md → "MEV Protection"
│  └─ Step 3: .env → set ENABLE_LIVE=true + RPC_URL

├─ Want to deploy?
│  └─ See: scripts/deploy-mocks.ts

└─ Want tests?
   ├─ Run: npm run test
   ├─ Add: test/unit/myfeature.test.ts
   └─ Reference: test/unit/matcher.test.ts
```

---

## Critical Safety Reminders ⚠️

```typescript
// ❌ WRONG - Real network without opt-in
MODE=live
ENABLE_LIVE=false  // This will crash!

// ✅ RIGHT - Opt-in explicitly
MODE=live
ENABLE_LIVE=true   // You chose this

// ✅ SAFE - Default (always use)
MODE=local
ENABLE_LIVE=false
```

---

## Troubleshooting

**Q: "Port 8545 already in use"**  
```bash
kill $(lsof -t -i:8545)  # Kill existing process
```

**Q: "Cannot find module 'ethers'"**  
```bash
npm install
npm run build
```

**Q: "No intents matching"**  
```bash
# Check mock intents exist
cat seeds/mock_intents.json

# Verify complement (Intent A sells X, B sells Y and vice versa)
# Check deadlines are in future (> current time)
```

**Q: "Transaction failed"**  
```bash
# Use callStatic to test (simulator.ts already does this)
# Check gas limits are sufficient
# Verify contract state (liquidity seeded)
```

---

## Performance Optimization Hints

| Area | Current | Optimized |
|------|---------|-----------|
| Matching | O(n²) naive | O(n) hash map + index |
| Simulation | Mock results | Real callStatic calls |
| Database | No indices | Add `CREATE INDEX` on status |
| RPC | Single provider | Multi-RPC failover |

---

## For Each Phase

### Phase 1: Learning (Current)
- Run locally with `npm run demo`
- Read code and understand flow
- Run tests: `npm run test`
- Modify mock intents in `seeds/`

### Phase 2: Development
- Uncomment real submission in `submitter.ts`
- Add real feed in `apiListener.ts`
- Write tests for new features
- Test on testnet (Sepolia/Goerli)

### Phase 3: Production
- Set `ENABLE_LIVE=true`
- Add MEV protection (Flashbots)
- Deploy to mainnet
- Monitor continuously

---

## Useful Links

- **Ethers.js**: https://docs.ethers.org/v6/
- **Hardhat**: https://hardhat.org/
- **Foundry**: https://book.getfoundry.sh/
- **CoW Protocol**: https://cow.fi/
- **Jest**: https://jestjs.io/

---

## One-Liners

```bash
# Build and run
npm run build && npm start

# Run with debugging
LOG_LEVEL=debug npm run dev

# Run tests with watch
npm run test -- --watch

# Format all code
npm run format

# Check database stats
sqlite3 ./data/bot.db "SELECT status, COUNT(*) FROM intents GROUP BY status;"

# Find all TODOs
grep -r "TODO" src/

# Count lines of code
find src -name "*.ts" | xargs wc -l
```

---

## Remember

1. **Local mode is safe** - Use it by default
2. **ENABLE_LIVE is a choice** - Only set to true when ready
3. **All code is commented** - Read the TODOs for next steps
4. **Tests are examples** - Copy patterns for new tests
5. **Database persists** - Check `./data/bot.db` for records

---

**Status**: ✅ Ready to run!  
**Time to first run**: ~5 minutes  
**Time to understand**: ~30 minutes  
**Time to extend**: ~2 hours  

Good luck! 🚀
