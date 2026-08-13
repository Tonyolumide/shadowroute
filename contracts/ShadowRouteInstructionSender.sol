// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ITeeExtensionRegistry} from "./interfaces/ITeeExtensionRegistry.sol";
import {ITeeMachineRegistry} from "./interfaces/ITeeMachineRegistry.sol";

/// @notice FCC entry point following Flare's official extension scaffold contract.
/// The message is an encrypted or JSON-encoded route-evaluation payload; production
/// uses the TEE node decrypt endpoint before the extension evaluates it.
contract ShadowRouteInstructionSender {
    bytes32 public constant OP_TYPE_SHADOW_ROUTE = bytes32("SHADOW_ROUTE");
    bytes32 public constant OP_COMMAND_EVALUATE = bytes32("EVALUATE");
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000;

    ITeeExtensionRegistry public immutable teeExtensionRegistry;
    ITeeMachineRegistry public immutable teeMachineRegistry;
    uint256 private extensionId;

    constructor(address extensionRegistry, address machineRegistry) {
        require(extensionRegistry.code.length > 0, "invalid extension registry");
        require(machineRegistry.code.length > 0, "invalid machine registry");
        teeExtensionRegistry = ITeeExtensionRegistry(extensionRegistry);
        teeMachineRegistry = ITeeMachineRegistry(machineRegistry);
    }

    function setExtensionId() external {
        require(extensionId == 0, "extension id already set");
        uint256 nextId = teeExtensionRegistry.nextPublicExtensionId();
        for (uint256 id = FIRST_PUBLIC_EXTENSION_ID; id < nextId; ++id) {
            if (teeExtensionRegistry.getTeeExtensionInstructionsSender(id) == address(this)) {
                extensionId = id;
                return;
            }
        }
        revert("extension id not found");
    }

    function sendEvaluation(bytes calldata message) external payable returns (bytes32 instructionId) {
        require(message.length != 0, "empty message");
        address[] memory teeIds = teeMachineRegistry.getRandomTeeIds(_extensionId(), 1);
        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_SHADOW_ROUTE,
            opCommand: OP_COMMAND_EVALUATE,
            message: message,
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });
        return teeExtensionRegistry.sendInstructions{value: msg.value}(teeIds, params);
    }

    function getExtensionId() external view returns (uint256) {
        return extensionId;
    }

    function _extensionId() internal view returns (uint256) {
        require(extensionId != 0, "extension id not set");
        return extensionId;
    }
}
