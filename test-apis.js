/**
 * Test script to verify API accessibility and response formats
 */

async function testCoWProtocol() {
  console.log('\n=== Testing CoW Protocol API ===');
  
  const endpoints = [
    'https://api.cow.fi/mainnet/api/v1/orders',
    'https://api.cow.fi/mainnet/api/v1/orders?chainId=10',
    'https://api.cow.fi/mainnet/api/v1/orders?chainId=10&limit=10',
    'https://api.cow.fi/mainnet/api/v1/metadata',
    'https://api.cow.fi/mainnet/health',
  ];

  for (const url of endpoints) {
    try {
      console.log(`\nTesting: ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      });

      console.log(`  Status: ${response.status} ${response.statusText}`);
      console.log(`  Content-Type: ${response.headers.get('content-type')}`);
      
      if (response.ok) {
        const data = await response.text();
        console.log(`  Response (first 200 chars): ${data.slice(0, 200)}`);
      } else {
        const error = await response.text().catch(() => 'Could not read error');
        console.log(`  Error: ${error.slice(0, 200)}`);
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }
  }
}

async function test1inch() {
  console.log('\n=== Testing 1inch API ===');
  
  const endpoints = [
    'https://api.1inch.dev/v5/10/health',
    'https://api.1inch.dev/v5/10/swap?fromTokenAddress=0x4200000000000000000000000000000000000006&toTokenAddress=0x7f5c764cbc14f9669b88dc4c52a84e7cffbf05c0&amount=1000000000000000000&fromAddress=0x0000000000000000000000000000000000000000&slippage=1',
  ];

  for (const url of endpoints) {
    try {
      console.log(`\nTesting: ${url.slice(0, 80)}...`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
      });

      console.log(`  Status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`  ✓ Response received (${JSON.stringify(data).length} bytes)`);
      } else {
        console.log(`  ✗ Status ${response.status}`);
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }
  }
}

async function testUniswap() {
  console.log('\n=== Testing Uniswap V3 Subgraph ===');
  
  const query = `{
    swaps(first: 5, skip: 0, where: {pool_: {feeTier: "3000"}}) {
      id
      amount0
      amount1
    }
  }`;

  try {
    console.log('Testing Uniswap V3 Subgraph (OP)...');
    const response = await fetch('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-optimism', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(3000),
    });

    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      const data = await response.json();
      console.log(`  ✓ Response received`);
      if (data.data && data.data.swaps) {
        console.log(`  Found ${data.data.swaps.length} swaps`);
      }
    }
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }
}

async function main() {
  console.log('Starting API accessibility tests...');
  
  await testCoWProtocol();
  await test1inch();
  await testUniswap();
  
  console.log('\n=== Tests Complete ===\n');
}

main().catch(console.error);
