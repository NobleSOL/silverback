import {
  SILVERBACK_V2_FACTORY,
  SILVERBACK_V2_ROUTER,
  isAddress,
} from "./config";
import type { Address } from "viem";

export const v2Abi = {
  factory: [
    {
      type: "function",
      name: "createPair",
      stateMutability: "nonpayable",
      inputs: [
        { name: "tokenA", type: "address" },
        { name: "tokenB", type: "address" },
      ],
      outputs: [{ name: "pair", type: "address" }],
    },
    {
      type: "function",
      name: "getPair",
      stateMutability: "view",
      inputs: [
        { name: "tokenA", type: "address" },
        { name: "tokenB", type: "address" },
      ],
      outputs: [{ name: "pair", type: "address" }],
    },
  ] as const,
  router: [
    {
      type: "function",
      name: "addLiquidity",
      stateMutability: "nonpayable",
      inputs: [
        { name: "tokenA", type: "address" },
        { name: "tokenB", type: "address" },
        { name: "amountADesired", type: "uint256" },
        { name: "amountBDesired", type: "uint256" },
        { name: "amountAMin", type: "uint256" },
        { name: "amountBMin", type: "uint256" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
      outputs: [
        { name: "amountA", type: "uint256" },
        { name: "amountB", type: "uint256" },
        { name: "liquidity", type: "uint256" },
      ],
    },
    {
      type: "function",
      name: "addLiquidityETH",
      stateMutability: "payable",
      inputs: [
        { name: "token", type: "address" },
        { name: "amountTokenDesired", type: "uint256" },
        { name: "amountTokenMin", type: "uint256" },
        { name: "amountETHMin", type: "uint256" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
      outputs: [
        { name: "amountToken", type: "uint256" },
        { name: "amountETH", type: "uint256" },
        { name: "liquidity", type: "uint256" },
      ],
    },
    {
      type: "function",
      name: "removeLiquidity",
      stateMutability: "nonpayable",
      inputs: [
        { name: "tokenA", type: "address" },
        { name: "tokenB", type: "address" },
        { name: "liquidity", type: "uint256" },
        { name: "amountAMin", type: "uint256" },
        { name: "amountBMin", type: "uint256" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
      outputs: [
        { name: "amountA", type: "uint256" },
        { name: "amountB", type: "uint256" },
      ],
    },
    {
      type: "function",
      name: "removeLiquidityETH",
      stateMutability: "nonpayable",
      inputs: [
        { name: "token", type: "address" },
        { name: "liquidity", type: "uint256" },
        { name: "amountTokenMin", type: "uint256" },
        { name: "amountETHMin", type: "uint256" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
      outputs: [
        { name: "amountToken", type: "uint256" },
        { name: "amountETH", type: "uint256" },
      ],
    },
  ] as const,
};

export function v2Addresses() {
  if (!isAddress(SILVERBACK_V2_FACTORY) || !isAddress(SILVERBACK_V2_ROUTER))
    return null;
  return {
    factory: SILVERBACK_V2_FACTORY as Address,
    router: SILVERBACK_V2_ROUTER as Address,
  };
}
