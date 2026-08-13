// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRouteAdapter} from "./interfaces/IRouteAdapter.sol";

contract ShadowRouter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum IntentStatus {
        None,
        Created,
        Funded,
        Executed,
        Cancelled
    }

    struct Intent {
        address owner;
        address tokenIn;
        uint256 amount;
        bytes32 ciphertextHash;
        uint64 expiry;
        uint64 nonce;
        IntentStatus status;
    }

    struct RouteAuthorization {
        bytes32 intentId;
        address owner;
        address tokenIn;
        uint256 maximumAmount;
        bytes32 intentCommitment;
        address adapter;
        address tokenOut;
        bytes32 actionHash;
        uint256 minimumOutput;
        uint64 intentNonce;
        uint64 deadline;
    }

    bytes32 public constant ROUTE_AUTHORIZATION_TYPEHASH = keccak256(
        "RouteAuthorization(bytes32 intentId,address owner,address tokenIn,uint256 maximumAmount,bytes32 intentCommitment,address adapter,address tokenOut,bytes32 actionHash,uint256 minimumOutput,uint64 intentNonce,uint64 deadline)"
    );

    address public owner;
    address public teeSigner;
    bool public paused;

    mapping(bytes32 => Intent) public intents;
    mapping(address => uint64) public nextIntentNonce;
    mapping(address => bool) public allowedAdapters;

    error Unauthorized();
    error InvalidAddress();
    error InvalidIntent();
    error InvalidStatus();
    error InvalidExpiry();
    error IntentExpired();
    error AuthorizationExpired();
    error InvalidAuthorization();
    error AdapterNotAllowed();
    error InvalidOutput();
    error ContractPaused();

    event IntentCreated(
        bytes32 indexed intentId,
        address indexed intentOwner,
        address indexed tokenIn,
        uint256 amount,
        bytes32 ciphertextHash,
        uint64 expiry,
        uint64 nonce
    );
    event IntentFunded(bytes32 indexed intentId, uint256 amount);
    event IntentExecuted(
        bytes32 indexed intentId,
        address indexed adapter,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event IntentCancelled(bytes32 indexed intentId, uint256 refundedAmount);
    event AdapterPermissionSet(address indexed adapter, bool allowed);
    event TeeSignerSet(address indexed previousSigner, address indexed newSigner);
    event PauseSet(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(address initialOwner, address initialTeeSigner) EIP712("ShadowRouter", "1") {
        if (initialOwner == address(0) || initialTeeSigner == address(0)) revert InvalidAddress();
        owner = initialOwner;
        teeSigner = initialTeeSigner;
        emit OwnershipTransferred(address(0), initialOwner);
        emit TeeSignerSet(address(0), initialTeeSigner);
    }

    function createIntent(
        address tokenIn,
        uint256 amount,
        bytes32 ciphertextHash,
        uint64 expiry
    ) external whenNotPaused returns (bytes32 intentId) {
        return _createIntent(msg.sender, tokenIn, amount, ciphertextHash, expiry);
    }

    /// @notice Creates and funds an intent in one call. This is the Smart Account
    /// path used after FXRP direct minting: the account approves this router, then
    /// invokes this function in the same PackedUserOperation.
    function createAndFundIntent(
        address tokenIn,
        uint256 amount,
        bytes32 ciphertextHash,
        uint64 expiry
    ) external nonReentrant whenNotPaused returns (bytes32 intentId) {
        intentId = _createIntent(msg.sender, tokenIn, amount, ciphertextHash, expiry);
        intents[intentId].status = IntentStatus.Funded;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amount);
        emit IntentFunded(intentId, amount);
    }

    function _createIntent(
        address intentOwner,
        address tokenIn,
        uint256 amount,
        bytes32 ciphertextHash,
        uint64 expiry
    ) internal returns (bytes32 intentId) {
        if (tokenIn == address(0) || amount == 0 || ciphertextHash == bytes32(0)) revert InvalidIntent();
        if (expiry <= block.timestamp) revert InvalidExpiry();

        uint64 nonce = nextIntentNonce[intentOwner]++;
        intentId = keccak256(abi.encode(intentOwner, tokenIn, amount, ciphertextHash, expiry, nonce));
        if (intents[intentId].status != IntentStatus.None) revert InvalidIntent();

        intents[intentId] = Intent({
            owner: intentOwner,
            tokenIn: tokenIn,
            amount: amount,
            ciphertextHash: ciphertextHash,
            expiry: expiry,
            nonce: nonce,
            status: IntentStatus.Created
        });

        emit IntentCreated(intentId, intentOwner, tokenIn, amount, ciphertextHash, expiry, nonce);
    }

    function fundIntent(bytes32 intentId) external nonReentrant whenNotPaused {
        Intent storage intent = intents[intentId];
        if (intent.owner != msg.sender) revert Unauthorized();
        if (intent.status != IntentStatus.Created) revert InvalidStatus();
        if (intent.expiry <= block.timestamp) revert IntentExpired();

        intent.status = IntentStatus.Funded;
        IERC20(intent.tokenIn).safeTransferFrom(msg.sender, address(this), intent.amount);
        emit IntentFunded(intentId, intent.amount);
    }

    function executeIntent(
        RouteAuthorization calldata authorization,
        bytes calldata signature,
        bytes calldata adapterData
    ) external nonReentrant whenNotPaused returns (address tokenOut, uint256 amountOut) {
        Intent storage intent = intents[authorization.intentId];
        if (intent.status != IntentStatus.Funded) revert InvalidStatus();
        if (intent.expiry <= block.timestamp) revert IntentExpired();
        if (authorization.deadline < block.timestamp) revert AuthorizationExpired();
        if (!allowedAdapters[authorization.adapter]) revert AdapterNotAllowed();
        if (
            authorization.owner != intent.owner ||
            authorization.tokenIn != intent.tokenIn ||
            authorization.maximumAmount != intent.amount ||
            authorization.intentCommitment != intent.ciphertextHash ||
            authorization.intentNonce != intent.nonce ||
            authorization.actionHash != keccak256(adapterData)
        ) revert InvalidAuthorization();

        bytes32 digest = _hashTypedDataV4(_hashAuthorization(authorization));
        if (ECDSA.recover(digest, signature) != teeSigner) revert InvalidAuthorization();

        if (authorization.tokenOut == address(0)) revert InvalidOutput();
        IERC20 inputToken = IERC20(intent.tokenIn);
        uint256 inputBalanceBefore = inputToken.balanceOf(address(this));
        IERC20 outputToken = IERC20(authorization.tokenOut);
        uint256 outputBalanceBefore = authorization.tokenOut == intent.tokenIn
            ? inputBalanceBefore
            : outputToken.balanceOf(address(this));
        inputToken.safeTransfer(authorization.adapter, intent.amount);

        (tokenOut, ) = IRouteAdapter(authorization.adapter).execute(
            intent.tokenIn,
            intent.amount,
            adapterData
        );
        if (tokenOut != authorization.tokenOut) revert InvalidOutput();

        uint256 baseline = tokenOut == intent.tokenIn ? outputBalanceBefore - intent.amount : outputBalanceBefore;
        uint256 outputBalanceAfter = outputToken.balanceOf(address(this));
        amountOut = outputBalanceAfter - baseline;
        if (amountOut < authorization.minimumOutput) revert InvalidOutput();

        intent.status = IntentStatus.Executed;
        outputToken.safeTransfer(intent.owner, amountOut);
        emit IntentExecuted(authorization.intentId, authorization.adapter, tokenOut, intent.amount, amountOut);
    }

    function cancelIntent(bytes32 intentId) external nonReentrant {
        Intent storage intent = intents[intentId];
        if (intent.owner != msg.sender) revert Unauthorized();
        if (intent.status != IntentStatus.Created && intent.status != IntentStatus.Funded) revert InvalidStatus();

        uint256 refund = intent.status == IntentStatus.Funded ? intent.amount : 0;
        intent.status = IntentStatus.Cancelled;
        if (refund != 0) IERC20(intent.tokenIn).safeTransfer(intent.owner, refund);
        emit IntentCancelled(intentId, refund);
    }

    function setAdapter(address adapter, bool allowed) external onlyOwner {
        if (adapter == address(0)) revert InvalidAddress();
        allowedAdapters[adapter] = allowed;
        emit AdapterPermissionSet(adapter, allowed);
    }

    function setTeeSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidAddress();
        address previous = teeSigner;
        teeSigner = newSigner;
        emit TeeSignerSet(previous, newSigner);
    }

    function setPaused(bool newPaused) external onlyOwner {
        paused = newPaused;
        emit PauseSet(newPaused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    function authorizationDigest(RouteAuthorization calldata authorization) external view returns (bytes32) {
        return _hashTypedDataV4(_hashAuthorization(authorization));
    }

    function _hashAuthorization(RouteAuthorization calldata authorization) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ROUTE_AUTHORIZATION_TYPEHASH,
                authorization.intentId,
                authorization.owner,
                authorization.tokenIn,
                authorization.maximumAmount,
                authorization.intentCommitment,
                authorization.adapter,
                authorization.tokenOut,
                authorization.actionHash,
                authorization.minimumOutput,
                authorization.intentNonce,
                authorization.deadline
            )
        );
    }
}
