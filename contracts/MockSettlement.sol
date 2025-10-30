// SPDX-License-Identifier: MIT
/**
 * contracts/MockSettlement.sol
 * PURPOSE: Mock settlement contract for atomic intent execution in local tests.
 * Simplified to work with the UniswapX Priority Order format.
 */

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockSettlement {
    // PriorityOrder struct (matches UniswapX and simulator encoding)
    struct PriorityOrder {
        bytes32 info;
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 minOutputAmount;
        address swapper;
        uint256 deadline;
        uint256 fee;
    }

    // Events
    event Fill(bytes32 indexed orderHash, address indexed filler, address indexed swapper, uint256 nonce);
    event Settled(address filler, uint256 profit);

    /**
     * Execute a Priority Order.
     * 
     * This is a MOCK implementation - it simply validates the order and returns successfully.
     */
    function execute(
        PriorityOrder calldata order,
        bytes calldata signature
    ) external payable returns (uint256 profit) {
        // MOCK VALIDATION
        require(order.deadline >= block.timestamp, "Order expired");
        require(order.inputAmount > 0, "Invalid input amount");
        require(order.minOutputAmount > 0, "Invalid output amount");
        require(order.swapper != address(0), "Invalid swapper");
        require(signature.length > 0, "Invalid signature");

        // MOCK EXECUTION: Just return a dummy profit
        // In reality, this would execute swaps and transfer tokens
        profit = order.inputAmount > 0 ? order.minOutputAmount / 100 : 0; // Mock: 1% profit

        // Emit Fill event (required by listeners)
        emit Fill(order.info, msg.sender, order.swapper, 1);
        emit Settled(msg.sender, profit);

        return profit;
    }

    /**
     * Legacy settle function (for backward compatibility)
     */
    struct Intent {
        string id;
        address maker;
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint256 deadline;
    }

    function settle(Intent calldata intentA, Intent calldata /*intentB*/) external pure returns (bool) {
        // Mock: Just validate and return success
        require(intentA.deadline > 0, "Valid intent");
        return true;
    }
}
