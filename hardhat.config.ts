/**
 * Hardhat Configuration
 * Used for compiling Solidity contracts and deploying to local test network
 * TODO: Add deploy plugins and additional network configurations as needed
 */

import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    hardhat: {
      chainId: 31337,
      forking: process.env.FORK_URL
        ? {
            url: process.env.FORK_URL,
          }
        : undefined,
    },
  },
  paths: {
    sources: './contracts',
    artifacts: './artifacts',
    cache: './cache',
  },
};

export default config;
