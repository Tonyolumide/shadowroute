// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ITeeExtensionRegistry } from "./interfaces/ITeeExtensionRegistry.sol";
import { ITeeMachineRegistry } from "./interfaces/ITeeMachineRegistry.sol";

/// @notice Official FCC scaffold entry point for ShadowRoute route evaluation.
contract HelloWorldInstructionSender {
    bytes32 public constant OP_TYPE_SHADOW_ROUTE = bytes32("SHADOW_ROUTE");
    bytes32 public constant OP_COMMAND_EVALUATE = bytes32("EVALUATE");
    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000;
    uint256 private _extensionId;

    constructor(ITeeExtensionRegistry extensionRegistry, ITeeMachineRegistry machineRegistry) {
        require(address(extensionRegistry) != address(0) && address(extensionRegistry).code.length > 0, "invalid extension registry");
        require(address(machineRegistry) != address(0) && address(machineRegistry).code.length > 0, "invalid machine registry");
        TEE_EXTENSION_REGISTRY = extensionRegistry;
        TEE_MACHINE_REGISTRY = machineRegistry;
    }

    function setExtensionId() external {
        require(_extensionId == 0, "Extension ID already set.");
        uint256 nextId = TEE_EXTENSION_REGISTRY.nextPublicExtensionId();
        for (uint256 id = FIRST_PUBLIC_EXTENSION_ID; id < nextId; ++id) {
            if (TEE_EXTENSION_REGISTRY.getTeeExtensionInstructionsSender(id) == address(this)) { _extensionId = id; return; }
        }
        revert("Extension ID not found.");
    }

    function sendEvaluation(bytes calldata message) external payable returns (bytes32) {
        require(message.length != 0, "empty message");
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({opType: OP_TYPE_SHADOW_ROUTE, opCommand: OP_COMMAND_EVALUATE, message: message, cosigners: cosigners, cosignersThreshold: 0, claimBackAddress: msg.sender});
        return TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }

    function getExtensionId() external view returns (uint256) { return _extensionId; }
    function _getExtensionId() internal view returns (uint256) { require(_extensionId != 0, "Extension ID is not set."); return _extensionId; }
}
