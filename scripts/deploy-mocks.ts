/**
 * scripts/deploy-mocks.ts
 * PURPOSE: Deploy mock AMM and settlement contracts to local test network.
 * Compiles Solidity contracts and deploys with initial liquidity.
 * 
 * USAGE:
 *   npx hardhat run scripts/deploy-mocks.ts --network localhost
 * 
 * OUTPUT:
 *   Prints deployed contract addresses to console and saves to file
 * 
 * TODO: Add deployment verification
 * TODO: Add contract initialization with seed liquidity
 * TODO: Add address persistence (e.g., to deploy-addresses.json)
 */

import hre from 'hardhat';
import * as fs from 'fs';

// Mock token addresses (using Hardhat default test accounts)
// In a real deployment, these would be actual ERC20 contracts
const MOCK_TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MOCK_TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function deployMocks() {
  // @ts-expect-error - ethers is injected by hardhat-toolbox
  const ethers = hre.ethers;
  console.log('🚀 Deploying mock contracts to local network...');
  console.log('');

  const signer = (await ethers.getSigners())[0];
  console.log(`📍 Deployer address: ${signer.address}`);
  console.log('');

  const deployedAddresses: Record<string, string | undefined> = {
    deployer: signer.address,
    timestamp: new Date().toISOString(),
  };

  try {
    // Deploy MockAMM #1 (for token pair A-B)
    console.log('📦 Deploying MockAMM #1...');
    const MockAMM1 = await ethers.getContractFactory('MockAMM');
    const amm1 = await MockAMM1.deploy(MOCK_TOKEN_A, MOCK_TOKEN_B);
    await amm1.deploymentTransaction()?.wait();
    console.log(`✅ MockAMM #1 deployed: ${amm1.target}`);
    deployedAddresses.ammA = amm1.target;

    // Deploy MockAMM #2 (for different token pair, if needed)
    console.log('📦 Deploying MockAMM #2...');
    const MockAMM2 = await ethers.getContractFactory('MockAMM');
    const amm2 = await MockAMM2.deploy(MOCK_TOKEN_B, MOCK_TOKEN_A);
    await amm2.deploymentTransaction()?.wait();
    console.log(`✅ MockAMM #2 deployed: ${amm2.target}`);
    deployedAddresses.ammB = amm2.target;

    // Deploy MockSettlement
    console.log('📦 Deploying MockSettlement...');
    const MockSettlement = await ethers.getContractFactory('MockSettlement');
    const settlement = await MockSettlement.deploy(amm1.target, amm2.target);
    await settlement.deploymentTransaction()?.wait();
    console.log(`✅ MockSettlement deployed: ${settlement.target}`);
    deployedAddresses.settlement = settlement.target;

    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║           Mock Contracts Deployed!                     ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║ MockAMM #1:      ${amm1.target}`);
    console.log(`║ MockAMM #2:      ${amm2.target}`);
    console.log(`║ Settlement:      ${settlement.target}`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');

    // TODO: Initialize with seed liquidity
    // Example:
    // console.log('💧 Seeding liquidity...');
    // const tokenA = await ethers.getContractAt('IERC20', MOCK_TOKEN_A, signer);
    // const tokenB = await ethers.getContractAt('IERC20', MOCK_TOKEN_B, signer);
    // const seedAmount = ethers.parseEther('1000');
    // await tokenA.approve(amm1.target, seedAmount);
    // await tokenB.approve(amm1.target, seedAmount);
    // await amm1.addLiquidity(seedAmount, seedAmount);
    // console.log('✅ Liquidity seeded');

    // Save addresses
    const outputPath = './deploy-addresses.json';
    fs.writeFileSync(outputPath, JSON.stringify(deployedAddresses, null, 2));
    console.log(`📄 Addresses saved to: ${outputPath}`);
    console.log('');

    // Print usage instructions
    console.log('📋 Next steps:');
    console.log('1. Copy contract addresses above');
    console.log('2. Update SETTLEMENT_ADDRESS and AMM_ADDRESS in src/index.ts');
    console.log('3. Run: npm run demo');
    console.log('');

    return deployedAddresses;
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

// Run deployment
deployMocks().catch((error) => {
  console.error(error);
  process.exit(1);
});
