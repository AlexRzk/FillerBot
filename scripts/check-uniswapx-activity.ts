/**
 * Script to check recent UniswapX activity on Base mainnet
 * This helps determine if there are actually orders to fill
 */

import { ethers } from 'ethers';

const UNISWAPX_REACTOR = '0x000000001Ec5656dcdB24D90DFa42742738De729';
const RPC_URL = process.env.RPC_URLS?.split(',')[0] || 'https://mainnet.base.org';

async function checkActivity() {
  console.log('Checking UniswapX activity on Base mainnet...\n');
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  // Get current block
  const currentBlock = await provider.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);
  
  // Check last 1000 blocks (~50 minutes on Base)
  const fromBlock = currentBlock - 1000;
  console.log(`Checking blocks ${fromBlock} to ${currentBlock}...\n`);
  
  // Check Fill events
  const fillTopic = ethers.id('Fill(bytes32,address,address,uint256)');
  
  try {
    const logs = await provider.getLogs({
      address: UNISWAPX_REACTOR,
      topics: [fillTopic],
      fromBlock,
      toBlock: currentBlock,
    });
    
    console.log(`✅ Found ${logs.length} Fill events in last 1000 blocks`);
    
    if (logs.length > 0) {
      console.log('\nRecent fills:');
      logs.slice(-5).forEach((log, i) => {
        const orderHash = log.topics[1];
        const filler = ethers.getAddress('0x' + log.topics[2].slice(26));
        console.log(`  ${i + 1}. Block ${log.blockNumber}: Order ${orderHash.slice(0, 10)}... filled by ${filler}`);
      });
    } else {
      console.log('⚠️  No recent Fill events found.');
      console.log('This suggests low UniswapX activity on Base right now.');
    }
    
  } catch (error: any) {
    console.error(`Error fetching logs: ${error.message}`);
  }
  
  // Check transaction count to reactor
  console.log('\nChecking transaction activity to UniswapX reactor...');
  const txCount = await provider.getTransactionCount(UNISWAPX_REACTOR);
  console.log(`Total transactions to reactor: ${txCount}`);
  
  // Get code to verify contract exists
  const code = await provider.getCode(UNISWAPX_REACTOR);
  if (code === '0x') {
    console.log('❌ ERROR: No code at reactor address!');
  } else {
    console.log(`✅ Contract verified at ${UNISWAPX_REACTOR}`);
    console.log(`   Code size: ${(code.length - 2) / 2} bytes`);
  }
}

checkActivity().catch(console.error);
