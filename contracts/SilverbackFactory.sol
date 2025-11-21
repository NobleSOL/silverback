// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ISilverbackFactory, ISilverbackPair } from "./interfaces.sol";
import { SilverbackPair } from "./SilverbackPair.sol";

contract SilverbackFactory is ISilverbackFactory {
    address public override feeTo;
    address public override feeToSetter;
    address[] public allPairs;
    mapping(address => mapping(address => address)) public override getPair;
    uint256 private pairCount;

    event FeeToSet(address indexed feeTo);
    event FeeToSetterSet(address indexed feeToSetter);

    constructor(address _feeToSetter) {
        require(_feeToSetter != address(0), "ZERO_ADDRESS");
        feeToSetter = _feeToSetter;
        feeTo = _feeToSetter;
        pairCount = 0;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        require(tokenA != tokenB, "IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(getPair[token0][token1] == address(0), "PAIR_EXISTS");
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        bytes memory bytecode = type(SilverbackPair).creationCode;
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        ISilverbackPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        pairCount += 1;
        emit PairCreated(token0, token1, pair, pairCount);
    }

    function allPairsLength() external view override returns (uint256) {
        return pairCount;
    }

    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, "FORBIDDEN");
        require(_feeTo != address(0), "ZERO_ADDRESS");
        feeTo = _feeTo;
        emit FeeToSet(_feeTo);
    }

    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, "FORBIDDEN");
        require(_feeToSetter != address(0), "ZERO_ADDRESS");
        feeToSetter = _feeToSetter;
        emit FeeToSetterSet(_feeToSetter);
    }

    function pairExists(address tokenA, address tokenB) external view returns (bool) {
        (address token0, ) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return getPair[token0][tokenB] != address(0);
    }

    function getPairAddress(address tokenA, address tokenB) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return getPair[token0][token1];
    }

    function computePairAddress(address tokenA, address tokenB) external view returns (address computed) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        bytes memory bytecode = type(SilverbackPair).creationCode;
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(bytecode)));
        return address(uint160(uint256(hash)));
    }
}
