// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRouter {
    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

/**
 * @title MockTaxToken
 * @notice Mock ERC20 with configurable buy/sell/transfer taxes for testing router behavior
 * @dev Simulates real-world tokens - collects tax in contract, swaps to ETH periodically
 */
contract MockTaxToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isExcludedFromTax;
    mapping(address => bool) public isPair;

    address public owner;
    address public taxRecipient;
    address public router;
    address public WETH;

    // Tax rates in basis points (100 = 1%)
    uint256 public buyTaxBps;      // Tax when buying from pair
    uint256 public sellTaxBps;     // Tax when selling to pair
    uint256 public transferTaxBps; // Tax on regular transfers

    // SwapBack mechanism
    uint256 public swapThreshold;  // Min tokens to trigger swap
    bool private inSwap;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event TaxCollected(address indexed from, address indexed to, uint256 amount, uint256 tax);
    event SwapBack(uint256 tokensSwapped, uint256 ethReceived);

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _buyTaxBps,
        uint256 _sellTaxBps,
        uint256 _transferTaxBps,
        address _router,
        address _weth
    ) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        taxRecipient = msg.sender;
        router = _router;
        WETH = _weth;

        buyTaxBps = _buyTaxBps;
        sellTaxBps = _sellTaxBps;
        transferTaxBps = _transferTaxBps;

        // Threshold to trigger swapBack (1% of supply)
        swapThreshold = _initialSupply / 100;

        // Owner and contract excluded from tax
        isExcludedFromTax[msg.sender] = true;
        isExcludedFromTax[address(this)] = true;

        _mint(msg.sender, _initialSupply);
    }

    modifier lockSwap() {
        inSwap = true;
        _;
        inSwap = false;
    }

    receive() external payable {}

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
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
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");

        // Check if we should swap collected taxes back to ETH
        bool shouldSwapBack = !inSwap &&
                             !isPair[from] &&  // Don't swap on buys
                             balanceOf[address(this)] >= swapThreshold &&
                             router != address(0);

        if (shouldSwapBack) {
            _swapBack();
        }

        uint256 tax = 0;
        uint256 amountAfterTax = amount;

        // Calculate tax if not excluded
        if (!inSwap && !isExcludedFromTax[from] && !isExcludedFromTax[to]) {
            // Buy tax: buying from pair (pair -> user)
            if (isPair[from] && buyTaxBps > 0) {
                tax = (amount * buyTaxBps) / 10000;
            }
            // Sell tax: selling to pair (user -> pair)
            else if (isPair[to] && sellTaxBps > 0) {
                tax = (amount * sellTaxBps) / 10000;
            }
            // Transfer tax: regular transfer
            else if (transferTaxBps > 0) {
                tax = (amount * transferTaxBps) / 10000;
            }

            amountAfterTax = amount - tax;
        }

        // Execute transfer
        balanceOf[from] -= amount;
        balanceOf[to] += amountAfterTax;

        // Collect tax in contract (not directly to recipient)
        if (tax > 0) {
            balanceOf[address(this)] += tax;
            emit TaxCollected(from, to, amount, tax);
            emit Transfer(from, address(this), tax);
        }

        emit Transfer(from, to, amountAfterTax);
    }

    function _swapBack() private lockSwap {
        uint256 tokensToSwap = balanceOf[address(this)];
        if (tokensToSwap == 0) return;

        // Approve router to spend tokens
        allowance[address(this)][router] = tokensToSwap;

        // Swap tokens for ETH
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = WETH;

        uint256 ethBefore = address(this).balance;

        try IRouter(router).swapExactTokensForETH(
            tokensToSwap,
            0, // Accept any amount of ETH
            path,
            address(this),
            block.timestamp
        ) {
            uint256 ethReceived = address(this).balance - ethBefore;

            // Send ETH to tax recipient
            if (ethReceived > 0) {
                (bool success, ) = taxRecipient.call{value: ethReceived}("");
                require(success, "ETH_TRANSFER_FAILED");
                emit SwapBack(tokensToSwap, ethReceived);
            }
        } catch {
            // If swap fails, just continue without reverting the transfer
            // This prevents stuck transfers if pair has low liquidity
        }
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // Admin functions
    function setPair(address pair, bool status) external {
        require(msg.sender == owner, "ONLY_OWNER");
        isPair[pair] = status;
    }

    function setTaxExclusion(address account, bool excluded) external {
        require(msg.sender == owner, "ONLY_OWNER");
        isExcludedFromTax[account] = excluded;
    }

    function setTaxes(uint256 _buyTaxBps, uint256 _sellTaxBps, uint256 _transferTaxBps) external {
        require(msg.sender == owner, "ONLY_OWNER");
        require(_buyTaxBps <= 2500, "MAX_25%"); // Max 25% tax
        require(_sellTaxBps <= 2500, "MAX_25%");
        require(_transferTaxBps <= 2500, "MAX_25%");
        buyTaxBps = _buyTaxBps;
        sellTaxBps = _sellTaxBps;
        transferTaxBps = _transferTaxBps;
    }

    function setTaxRecipient(address _taxRecipient) external {
        require(msg.sender == owner, "ONLY_OWNER");
        taxRecipient = _taxRecipient;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "ONLY_OWNER");
        _mint(to, amount);
    }

    function setSwapThreshold(uint256 _swapThreshold) external {
        require(msg.sender == owner, "ONLY_OWNER");
        swapThreshold = _swapThreshold;
    }

    function manualSwapBack() external {
        require(msg.sender == owner, "ONLY_OWNER");
        _swapBack();
    }
}
