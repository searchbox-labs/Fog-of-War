// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract FogVault {
    // ─── State ────────────────────────────────────────────────
    address public session;     // the FogSession contract that owns this vault
    uint256 public entryFee;
    uint256 public totalPool;
    bool    public paid;

    uint256 public constant HOUSE_CUT    = 10; // 10%
    uint256 public constant WINNER_SHARE = 90; // 90%

    mapping(address => uint256) public deposits;

    // ─── Events ───────────────────────────────────────────────
    event Deposited(address indexed player, uint256 amount);
    event Paid(address indexed winner, uint256 prize, uint256 houseCut);

    // ─── Modifiers ────────────────────────────────────────────
    modifier onlySession() {
        require(msg.sender == session, "Only session contract");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────
    constructor(address _session, uint256 _entryFee) {
        session  = _session;
        entryFee = _entryFee;
    }

    // ─── Deposit ──────────────────────────────────────────────
    /// @notice Called by FogSession when a player joins
    function deposit(address player) external payable onlySession {
        require(msg.value == entryFee, "Wrong deposit amount");
        require(deposits[player] == 0, "Already deposited");

        deposits[player] = msg.value;
        totalPool += msg.value;

        emit Deposited(player, msg.value);
    }

    // ─── Payout ───────────────────────────────────────────────
    /// @notice Called by FogSession when session ends — pays winner 90%, house 10%
    function payout(address winner) external onlySession returns (uint256) {
        require(!paid, "Already paid out");
        require(totalPool > 0, "Empty pool");

        paid = true;

        uint256 prize    = (totalPool * WINNER_SHARE) / 100;
        uint256 houseFee = totalPool - prize;

        // Pay winner
        payable(winner).transfer(prize);

        // Pay house (the session contract's owner via session)
        payable(session).transfer(houseFee);

        emit Paid(winner, prize, houseFee);

        return prize;
    }

    // ─── View ─────────────────────────────────────────────────
    function getPool() external view returns (uint256) {
        return totalPool;
    }

    // Allow vault to receive ETH directly if needed
    receive() external payable {}
}