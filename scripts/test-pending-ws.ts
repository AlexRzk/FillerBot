import { ethers } from 'ethers';

// Diagnostic script: listens to pending txs and reports any to the UniswapX reactor
const WS = process.env.WS_RPC_URL || 'wss://base-mainnet.g.alchemy.com/v2/YOUR_KEY';
const REACTOR = '0x000000001Ec5656dcdB24D90DFa42742738De729'.toLowerCase();

async function main() {
  console.log('Connecting to WS RPC:', WS);
  const provider = new ethers.WebSocketProvider(WS);

  let seen = 0;

  const onPending = async (txHash: string) => {
    seen++;
    if (seen % 100 === 0) console.log(`Seen ${seen} pending tx hashes...`);

    try {
      const tx = await provider.getTransaction(txHash);
      if (!tx) return;

      if (tx.to && tx.to.toLowerCase() === REACTOR) {
        console.log('\n✅ Found reactor tx:', txHash);
        console.log('   from:', tx.from);
        console.log('   value:', tx.value?.toString());
        console.log('   data length:', tx.data?.length);
      }
    } catch (err) {
      // ignore fetch errors
    }
  };

  // Subscribe to pending txs
  provider.on('pending', onPending);

  console.log('Listening for pending transactions... (Ctrl+C to stop)');
  console.log('(Will show a message every 100 pending txs seen)');

  // Keep alive
  await new Promise(() => {});
}

main().catch((e) => console.error(e));
