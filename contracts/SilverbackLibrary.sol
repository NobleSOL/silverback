// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ISilverbackFactory, ISilverbackPair } from "./interfaces.sol";
import { SilverbackPair } from "./SilverbackPair.sol";

library SilverbackLibrary {
    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, "IDENTICAL_ADDRESSES");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ZERO_ADDRESS");
    }

    function pairFor(address factory, address tokenA, address tokenB) internal pure returns (address pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), factory, salt, keccak256(type(SilverbackPair).creationCode))
        );
        pair = address(uint160(uint(hash)));
    }

    function getReserves(address factory, address tokenA, address tokenB)
        internal
        view
        returns (uint reserveA, uint reserveB)
    {
        (address token0, ) = sortTokens(tokenA, tokenB);
        address pair = ISilverbackFactory(factory).getPair(tokenA, tokenB);
        require(pair != address(0), "PAIR_NOT_FOUND");
        (uint112 reserve0, uint112 reserve1, ) = ISilverbackPair(pair).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (uint(reserve0), uint(reserve1)) : (uint(reserve1), uint(reserve0));
    }

    function quote(uint amountA, uint reserveA, uint reserveB) internal pure returns (uint amountB) {
        require(amountA > 0, "INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) internal pure returns (uint amountOut) {
        require(amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_LIQUIDITY");
        uint amountInWithFee = amountIn * 997;
        uint numerator = amountInWithFee * reserveOut;
        uint denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) internal pure returns (uint amountIn) {
        require(amountOut > 0, "INSUFFICIENT_OUTPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_LIQUIDITY");
        uint numerator = reserveIn * amountOut * 1000;
        uint denominator = (reserveOut - amountOut) * 997;
        amountIn = (numerator / denominator) + 1;
    }

    function getAmountsOut(address factory, uint amountIn, address[] memory path)
        internal
        view
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, "INVALID_PATH");
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        for (uint i; i < path.length - 1; i++) {
            (uint reserveIn, uint reserveOut) = getReserves(factory, path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function getAmountsIn(address factory, uint amountOut, address[] memory path)
        internal
        view
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, "INVALID_PATH");
        amounts = new uint[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint i = path.length - 1; i > 0; i--) {
            (uint reserveIn, uint reserveOut) = getReserves(factory, path[i - 1], path[i]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }
}
