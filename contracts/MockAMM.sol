// SPDX-License-Identifier: MIT
/**
 * contracts/MockAMM.sol
 * PURPOSE: Minimal Uniswap-like AMM for local testing.
 * Implements constant product formula: x * y = k
 * 
 * FEATURES:
 * - Add/remove liquidity
 * - Swap with deterministic pricing
 * - No fees (for simplicity)
 * 
 * TODO: Add realistic fee mechanisms
 * TODO: Add slippage tolerance
 * TODO: Add oracle integration
 */

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockAMM {
    // Token pair
    IERC20 public tokenA;
    IERC20 public tokenB;

    // Reserves
    uint256 public reserveA;
    uint256 public reserveB;

    // Total liquidity shares
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event Swapped(address indexed swapper, address indexed tokenIn, uint256 amountIn, address indexed tokenOut, uint256 amountOut);

    /**
     * Initialize AMM with token pair.
     */
    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token addresses");
        require(_tokenA != _tokenB, "Tokens must be different");

        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        reserveA = 0;
        reserveB = 0;
    }

    /**
     * Add liquidity to the pool.
     * Minter receives shares proportional to liquidity added.
     * 
     * TODO: Handle edge cases (empty pool, overflow)
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 liquidityShares) {
        require(amountA > 0 && amountB > 0, "Amounts must be positive");

        // Transfer tokens from user
        require(tokenA.transferFrom(msg.sender, address(this), amountA), "TokenA transfer failed");
        require(tokenB.transferFrom(msg.sender, address(this), amountB), "TokenB transfer failed");

        if (totalShares == 0) {
            // First liquidity provider
            liquidityShares = amountA * amountB; // Geometric mean
        } else {
            // Proportional shares
            // shares = min(amountA / reserveA, amountB / reserveB) * totalShares
            uint256 shareA = (amountA * totalShares) / reserveA;
            uint256 shareB = (amountB * totalShares) / reserveB;
            liquidityShares = shareA < shareB ? shareA : shareB;
        }

        reserveA += amountA;
        reserveB += amountB;
        totalShares += liquidityShares;
        shares[msg.sender] += liquidityShares;

        emit LiquidityAdded(msg.sender, amountA, amountB, liquidityShares);
    }

    /**
     * Remove liquidity from the pool.
     */
    function removeLiquidity(uint256 liquidityShares) external returns (uint256 amountA, uint256 amountB) {
        require(shares[msg.sender] >= liquidityShares, "Insufficient shares");
        require(liquidityShares > 0, "Amount must be positive");

        amountA = (liquidityShares * reserveA) / totalShares;
        amountB = (liquidityShares * reserveB) / totalShares;

        require(amountA > 0 && amountB > 0, "Output amounts must be positive");

        reserveA -= amountA;
        reserveB -= amountB;
        totalShares -= liquidityShares;
        shares[msg.sender] -= liquidityShares;

        require(tokenA.transfer(msg.sender, amountA), "TokenA transfer failed");
        require(tokenB.transfer(msg.sender, amountB), "TokenB transfer failed");

        emit LiquidityRemoved(msg.sender, amountA, amountB, liquidityShares);
    }

    /**
     * Calculate output amount for a swap using constant product formula.
     * amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
     */
    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256 amountOut) {
        require(amountIn > 0, "Amount in must be positive");

        uint256 reserveIn;
        uint256 reserveOut;

        if (tokenIn == address(tokenA)) {
            reserveIn = reserveA;
            reserveOut = reserveB;
        } else if (tokenIn == address(tokenB)) {
            reserveIn = reserveB;
            reserveOut = reserveA;
        } else {
            revert("Invalid token");
        }

        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 numerator = amountIn * reserveOut;
        uint256 denominator = reserveIn + amountIn;
        amountOut = numerator / denominator;
    }

    /**
     * Swap tokens atomically.
     * User sends tokenIn, receives tokenOut.
     */
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        require(amountIn > 0, "Amount in must be positive");

        // Determine token pair and transfers
        if (tokenIn == address(tokenA)) {
            amountOut = getAmountOut(tokenIn, amountIn);
            require(amountOut >= minAmountOut, "Insufficient output amount");

            require(tokenA.transferFrom(msg.sender, address(this), amountIn), "TokenA transfer failed");
            require(tokenB.transfer(msg.sender, amountOut), "TokenB transfer failed");

            reserveA += amountIn;
            reserveB -= amountOut;
        } else if (tokenIn == address(tokenB)) {
            amountOut = getAmountOut(tokenIn, amountIn);
            require(amountOut >= minAmountOut, "Insufficient output amount");

            require(tokenB.transferFrom(msg.sender, address(this), amountIn), "TokenB transfer failed");
            require(tokenA.transfer(msg.sender, amountOut), "TokenA transfer failed");

            reserveB += amountIn;
            reserveA -= amountOut;
        } else {
            revert("Invalid token");
        }

        emit Swapped(msg.sender, tokenIn, amountIn, tokenIn == address(tokenA) ? address(tokenB) : address(tokenA), amountOut);
    }

    /**
     * Get current reserves (for debugging/testing).
     */
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }
}
