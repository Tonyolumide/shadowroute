// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRouteAdapter} from "./interfaces/IRouteAdapter.sol";
import {IUniswapV2Router} from "./interfaces/IUniswapV2Router.sol";

/// @notice A deliberately narrow adapter for V2-compatible spot routers.
/// It cannot call arbitrary targets and can only return output to ShadowRouter.
contract UniswapV2RouteAdapter is IRouteAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable shadowRouter;
    IUniswapV2Router public immutable exchangeRouter;

    error Unauthorized();
    error InvalidAddress();
    error InvalidPath();
    error InvalidDeadline();
    error InvalidOutput();

    constructor(address shadowRouter_, address exchangeRouter_) {
        if (shadowRouter_ == address(0) || exchangeRouter_ == address(0)) revert InvalidAddress();
        if (shadowRouter_.code.length == 0 || exchangeRouter_.code.length == 0) revert InvalidAddress();
        shadowRouter = shadowRouter_;
        exchangeRouter = IUniswapV2Router(exchangeRouter_);
    }

    /// @param data ABI encoding of (address[] path, uint256 amountOutMin, uint256 deadline).
    function execute(
        address tokenIn,
        uint256 amountIn,
        bytes calldata data
    ) external nonReentrant returns (address tokenOut, uint256 amountOut) {
        if (msg.sender != shadowRouter) revert Unauthorized();
        (address[] memory path, uint256 amountOutMin, uint256 deadline) = abi.decode(data, (address[], uint256, uint256));
        if (deadline < block.timestamp) revert InvalidDeadline();
        if (path.length < 2 || path.length > 4 || path[0] != tokenIn) revert InvalidPath();
        tokenOut = path[path.length - 1];
        if (tokenOut == address(0) || tokenOut == tokenIn || amountOutMin == 0) revert InvalidOutput();

        IERC20 input = IERC20(tokenIn);
        IERC20 output = IERC20(tokenOut);
        uint256 beforeBalance = output.balanceOf(address(this));
        input.forceApprove(address(exchangeRouter), amountIn);
        exchangeRouter.swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);
        input.forceApprove(address(exchangeRouter), 0);
        amountOut = output.balanceOf(address(this)) - beforeBalance;
        if (amountOut < amountOutMin) revert InvalidOutput();
        output.safeTransfer(shadowRouter, amountOut);
    }
}
