// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRouteAdapter} from "../interfaces/IRouteAdapter.sol";

contract MockRouteAdapter is IRouteAdapter {
    using SafeERC20 for IERC20;

    address public immutable router;

    error OnlyRouter();

    constructor(address router_) {
        router = router_;
    }

    function execute(
        address,
        uint256 amountIn,
        bytes calldata adapterData
    ) external returns (address tokenOut, uint256 amountOut) {
        if (msg.sender != router) revert OnlyRouter();
        uint256 numerator;
        uint256 denominator;
        (tokenOut, numerator, denominator) = abi.decode(
            adapterData,
            (address, uint256, uint256)
        );
        amountOut = amountIn * numerator / denominator;
        IERC20(tokenOut).safeTransfer(router, amountOut);
    }
}
