// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./FogVault.sol";

contract FogSession {
    // ─── Enums ───────────────────────────────────────────────
    enum SessionState { WAITING, ACTIVE, ENDED }

    // ─── Structs ─────────────────────────────────────────────
    struct Session {
        uint256 id;
        address creator;
        uint256 entryFee;       // in wei
        uint256 maxPlayers;
        uint256 duration;       // in seconds
        uint256 startTime;
        SessionState state;
        address[] players;
        address winner;
        FogVault vault;
    }

    // ─── State ────────────────────────────────────────────────
    uint256 public sessionCount;
    uint256 public constant CREATION_FEE = 0.5 ether;
    uint256 public constant ENTRY_FEE    = 1 ether;
    address public owner;

    mapping(uint256 => Session) public sessions;
    mapping(uint256 => mapping(address => bool)) public hasJoined;

    // ─── Events ───────────────────────────────────────────────
    event SessionCreated(uint256 indexed sessionId, address indexed creator, uint256 maxPlayers);
    event PlayerJoined(uint256 indexed sessionId, address indexed player);
    event SessionStarted(uint256 indexed sessionId, uint256 startTime);
    event SessionEnded(uint256 indexed sessionId, address indexed winner, uint256 prize);

    // ─── Modifiers ────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier sessionExists(uint256 sessionId) {
        require(sessionId < sessionCount, "Session does not exist");
        _;
    }

    modifier inState(uint256 sessionId, SessionState expected) {
        require(sessions[sessionId].state == expected, "Wrong session state");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ─── Create Session ───────────────────────────────────────
    /// @notice Creator pays 0.5 SOL creation fee to spin up a session
    function createSession(uint256 maxPlayers, uint256 durationSeconds) external payable {
        require(msg.value == CREATION_FEE, "Must pay 0.5 ETH creation fee");
        require(maxPlayers >= 2 && maxPlayers <= 200, "Players must be between 2 and 200");
        require(durationSeconds >= 60, "Duration must be at least 60 seconds");

        // Deploy a fresh vault for this session
        FogVault vault = new FogVault(address(this), ENTRY_FEE);

        uint256 sessionId = sessionCount++;

        Session storage s = sessions[sessionId];
        s.id         = sessionId;
        s.creator    = msg.sender;
        s.entryFee   = ENTRY_FEE;
        s.maxPlayers = maxPlayers;
        s.duration   = durationSeconds;
        s.state      = SessionState.WAITING;
        s.vault      = vault;

        // Forward creation fee to owner (house)
        payable(owner).transfer(msg.value);

        emit SessionCreated(sessionId, msg.sender, maxPlayers);
    }

    // ─── Join Session ─────────────────────────────────────────
    /// @notice Player pays entry fee to join a waiting session
    function joinSession(uint256 sessionId)
        external
        payable
        sessionExists(sessionId)
        inState(sessionId, SessionState.WAITING)
    {
        Session storage s = sessions[sessionId];

        require(!hasJoined[sessionId][msg.sender], "Already joined");
        require(s.players.length < s.maxPlayers, "Session is full");
        require(msg.value == s.entryFee, "Wrong entry fee");

        hasJoined[sessionId][msg.sender] = true;
        s.players.push(msg.sender);

        // Forward entry fee directly into the vault
        s.vault.deposit{value: msg.value}(msg.sender);

        emit PlayerJoined(sessionId, msg.sender);
    }

    // ─── Start Session ────────────────────────────────────────
    /// @notice Creator starts the session once enough players joined
    function startSession(uint256 sessionId)
        external
        sessionExists(sessionId)
        inState(sessionId, SessionState.WAITING)
    {
        Session storage s = sessions[sessionId];
        require(msg.sender == s.creator, "Only creator can start");
        require(s.players.length >= 2, "Need at least 2 players");

        s.state     = SessionState.ACTIVE;
        s.startTime = block.timestamp;

        emit SessionStarted(sessionId, block.timestamp);
    }

    // ─── End Session ──────────────────────────────────────────
    /// @notice Owner or game server calls this to declare a winner
    function endSession(uint256 sessionId, address winner)
        external
        onlyOwner
        sessionExists(sessionId)
        inState(sessionId, SessionState.ACTIVE)
    {
        Session storage s = sessions[sessionId];

        require(hasJoined[sessionId][winner], "Winner must be a player");
        require(
            block.timestamp >= s.startTime + s.duration,
            "Session still running"
        );

        s.state  = SessionState.ENDED;
        s.winner = winner;

        // Trigger payout from vault
        uint256 prize = s.vault.payout(winner);

        emit SessionEnded(sessionId, winner, prize);
    }

    // ─── Views ────────────────────────────────────────────────
    function getPlayers(uint256 sessionId) external view returns (address[] memory) {
        return sessions[sessionId].players;
    }

    function getPlayerCount(uint256 sessionId) external view returns (uint256) {
        return sessions[sessionId].players.length;
    }

    function getVault(uint256 sessionId) external view returns (address) {
        return address(sessions[sessionId].vault);
    }
}