// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV2Router} from "../interfaces/IUniswapV2Router.sol";

contract MockV2Router is IUniswapV2Router {
    using SafeERC20 for IERC20;
    uint256 public immutable numerator;
    uint256 public immutable denominator;

    constructor(uint256 numerator_, uint256 denominator_) { numerator = numerator_; denominator = denominator_; }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp && path.length >= 2, "invalid swap");
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = amountIn * numerator / denominator;
        require(amountOut >= amountOutMin, "slippage");
        IERC20(path[path.length - 1]).safeTransfer(to, amountOut);
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;
    }
}
