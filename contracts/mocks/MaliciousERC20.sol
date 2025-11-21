// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISilverbackPair {
    function mint(address to) external returns (uint256 liquidity);
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title Malicious ERC20 for testing reentrancy protection
/// @notice This token attempts to reenter target contracts during transfers
contract MaliciousERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // Reentrancy attack configuration
    address public reentrancyTarget;
    string public reentrancyFunction = "swap";
    bool public reentrancyEnabled;

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        _mint(msg.sender, _initialSupply);
    }

    function setReentrancyTarget(address _target) external {
        reentrancyTarget = _target;
    }

    function setReentrancyFunction(string memory _function) external {
        reentrancyFunction = _function;
    }

    function enableReentrancy(bool _enabled) external {
        reentrancyEnabled = _enabled;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);

        // Attempt reentrancy if enabled
        if (reentrancyEnabled && reentrancyTarget != address(0)) {
            _attemptReentrancy();
        }

        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);

        // Attempt reentrancy if enabled
        if (reentrancyEnabled && reentrancyTarget != address(0)) {
            _attemptReentrancy();
        }

        return true;
    }

    function _attemptReentrancy() internal {
        ISilverbackPair target = ISilverbackPair(reentrancyTarget);

        // Try to reenter the target function
        try target.swap(0, 1, address(this), "") {
            // Reentrancy succeeded (should not happen with guards)
        } catch {
            // Reentrancy was prevented (expected with guards)
        }
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
