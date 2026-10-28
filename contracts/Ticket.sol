// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Ticket
/// @notice ERC-721 tickets for a single event. Deployed by EventFactory.
///         After mint, tickets can only move through the Marketplace.
contract Ticket is ERC721, ReentrancyGuard {
    address public immutable factory;
    address public immutable marketplace;
    address public immutable organizer;
    uint256 public immutable faceValue;
    uint32 public immutable maxSupply;
    uint16 public immutable maxPerWallet;
    uint16 public immutable resaleCapBps;
    uint16 public immutable royaltyBps;

    uint256 public totalMinted;
    uint256 public proceeds;
    mapping(address => uint256) public primaryPurchases;
    mapping(uint256 => bool) public used;
    mapping(address => bool) public isGate;

    event TicketPurchased(address indexed buyer, uint256 firstId, uint256 quantity);
    event ProceedsWithdrawn(address indexed organizer, uint256 amount);
    event GateSet(address indexed gate, bool allowed);
    event CheckedIn(uint256 indexed id, address indexed holder);

    error NotImplemented();
    error NotOrganizer();
    error NotMarketplace();
    error NotGate();
    error TransfersDisabled();

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer();
        _;
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert NotMarketplace();
        _;
    }

    modifier onlyGate() {
        if (!isGate[msg.sender]) revert NotGate();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address marketplace_,
        address organizer_,
        uint256 faceValue_,
        uint32 maxSupply_,
        uint16 maxPerWallet_,
        uint16 resaleCapBps_,
        uint16 royaltyBps_
    ) ERC721(name_, symbol_) {
        factory = msg.sender;
        marketplace = marketplace_;
        organizer = organizer_;
        faceValue = faceValue_;
        maxSupply = maxSupply_;
        maxPerWallet = maxPerWallet_;
        resaleCapBps = resaleCapBps_;
        royaltyBps = royaltyBps_;
    }

    // ---------------------------------------------------------------- primary sale

    /// @notice Buy `quantity` tickets at face value.
    /// @param quantity Number of tickets to mint to the caller.
    function buy(uint256 quantity) external payable {
        // TODO: check msg.value, maxSupply, maxPerWallet; mint sequential ids from 1
        revert NotImplemented();
    }

    /// @notice Organizer withdraws primary sale proceeds.
    function withdrawProceeds() external onlyOrganizer nonReentrant {
        // TODO: send `proceeds` to organizer, reset to 0
        revert NotImplemented();
    }

    // ---------------------------------------------------------------- transfers

    /// @notice Move a ticket on behalf of the marketplace after a sale settles.
    /// @param from Current owner (seller).
    /// @param to New owner (buyer).
    /// @param id Token id.
    function marketplaceTransfer(address from, address to, uint256 id) external onlyMarketplace {
        // TODO: _transfer(from, to, id)
        revert NotImplemented();
    }

    /// @dev Transfer lock: after mint, only the marketplace may move tokens.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        // TODO: if (_ownerOf(tokenId) != address(0) && msg.sender != marketplace) revert TransfersDisabled();
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------- check-in

    /// @notice Organizer authorises or revokes a gate scanner address.
    /// @param gate Scanner address.
    /// @param allowed Whether the address may check tickets in.
    function setGate(address gate, bool allowed) external onlyOrganizer {
        isGate[gate] = allowed;
        emit GateSet(gate, allowed);
    }

    /// @notice Check a ticket in using the holder's signed QR payload.
    /// @param id Token id.
    /// @param validUntil Expiry timestamp signed by the holder.
    /// @param signature Holder's EIP-191 signature over (this, chainid, id, validUntil).
    function checkIn(uint256 id, uint256 validUntil, bytes calldata signature) external onlyGate {
        // TODO: verify expiry, recover signer == ownerOf(id), !used[id]; mark used, emit CheckedIn
        revert NotImplemented();
    }

    // ---------------------------------------------------------------- views

    /// @notice Highest price this ticket may be resold for.
    function maxResalePrice() public view returns (uint256) {
        return (faceValue * resaleCapBps) / 10_000;
    }

    /// @notice True if the ticket exists and has not been used.
    /// @param id Token id.
    function isValid(uint256 id) external view returns (bool) {
        return _ownerOf(id) != address(0) && !used[id];
    }
}
