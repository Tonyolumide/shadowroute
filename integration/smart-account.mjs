import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toHex
} from "viem";

const erc20Abi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const shadowRouterAbi = parseAbi([
  "function createAndFundIntent(address tokenIn,uint256 amount,bytes32 ciphertextHash,uint64 expiry) returns (bytes32 intentId)"
]);
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const PACKED_USER_OPERATION_TUPLE = {
  type: "tuple",
  components: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "signature", type: "bytes" }
  ]
};

export function buildMintAndDepositCalls({ fxrp, router, amount, ciphertextHash, expiry }) {
  return [
    {
      target: fxrp,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, amount] })
    },
    {
      target: router,
      value: 0n,
      data: encodeFunctionData({
        abi: shadowRouterAbi,
        functionName: "createAndFundIntent",
        args: [fxrp, amount, ciphertextHash, expiry]
      })
    }
  ];
}

export function encodeHashInstructionMemo({ calls, sender, nonce, walletId = 0, executorFeeUBA = 0n }) {
  const callData = encodeFunctionData({
    abi: coston2.iPersonalAccountAbi,
    functionName: "executeUserOp",
    args: [calls]
  });
  const data = encodeAbiParameters([PACKED_USER_OPERATION_TUPLE], [{
    sender,
    nonce,
    initCode: "0x",
    callData,
    accountGasLimits: ZERO_BYTES32,
    preVerificationGas: 0n,
    gasFees: ZERO_BYTES32,
    paymasterAndData: "0x",
    signature: "0x"
  }]);
  const userOpHash = keccak256(data);
  const memoData = concatHex(["0xFE", toHex(walletId, { size: 1 }), toHex(executorFeeUBA, { size: 8 }), userOpHash]);
  return { memoData, data, userOpHash, calls };
}
