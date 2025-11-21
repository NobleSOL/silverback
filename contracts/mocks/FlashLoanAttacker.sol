// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISilverbackPair {
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

/// @title Flash Loan Attacker for testing
/// @notice Attempts to exploit via flash loan + reentrancy
contract FlashLoanAttacker {
    address public pair;
    bool public attacking;

    constructor(address _pair) {
        pair = _pair;
    }

    /// @notice Attempt flash loan attack with reentrancy
    function attack(uint256 amount) external {
        attacking = true;

        // Request flash loan via swap callback
        ISilverbackPair(pair).swap(amount, 0, address(this), abi.encode(amount));
    }

    /// @notice Callback from pair during swap
    function silverbackV2Call(
        address sender,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external {
        require(msg.sender == pair, "UNAUTHORIZED");
        require(attacking, "NOT_ATTACKING");

        // Attempt to reenter during callback (should fail with reentrancy guard)
        try ISilverbackPair(pair).swap(amount0 / 2, 0, address(this), "") {
            // Reentrancy succeeded - should not happen!
            revert("REENTRANCY_NOT_PREVENTED");
        } catch {
            // Reentrancy was prevented - this is expected
        }

        // Repay flash loan
        address token0 = ISilverbackPair(pair).token0();
        uint256 amountToRepay = abi.decode(data, (uint256));

        // Add small amount for fees
        uint256 amountWithFee = (amountToRepay * 1004) / 1000;

        IERC20(token0).transfer(pair, amountWithFee);

        attacking = false;
    }
}
