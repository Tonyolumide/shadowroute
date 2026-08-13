// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IRouteAdapter {
    function execute(
        address tokenIn,
        uint256 amountIn,
        bytes calldata adapterData
    ) external returns (address tokenOut, uint256 reportedAmountOut);
}
