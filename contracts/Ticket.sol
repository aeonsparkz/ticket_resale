// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Per-event parameters chosen by the organizer in `EventFactory.createEvent`.
struct EventParams {
    string name; // ERC-721 name, e.g. "Coldplay SG 2027"
    string symbol; // ERC-721 symbol
    uint256 faceValue; // primary price per ticket in wei
    uint32 maxSupply; // total tickets available
    uint16 maxPerWallet; // max primary purchases per wallet
    uint16 resaleCapBps; // resale cap as basis points of face value (10_000 = 100%)
    uint16 royaltyBps; // organizer royalty on resale in basis points
    uint64 eventTime; // event start (Unix seconds); trading closes at this time
}

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
    uint64 public immutable eventTime;

    /// @notice How long after `eventTime` tickets can still be checked in.
    uint256 public constant CHECKIN_WINDOW = 12 hours;

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
    error TradingClosed();
    error InvalidQuantity();
    error SoldOut(uint256 remaining);
    error WalletLimitExceeded(uint256 remaining);
    error WrongPayment(uint256 sent, uint256 expected);
    error NoProceeds();
    error TransferFailed();

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

    /// @param p Event parameters (validated by the factory).
    /// @param marketplace_ The platform Marketplace, the only address allowed to move tokens.
    /// @param organizer_ The event organizer.
    constructor(EventParams memory p, address marketplace_, address organizer_) ERC721(p.name, p.symbol) {
        factory = msg.sender;
        marketplace = marketplace_;
        organizer = organizer_;
        faceValue = p.faceValue;
        maxSupply = p.maxSupply;
        maxPerWallet = p.maxPerWallet;
        resaleCapBps = p.resaleCapBps;
        royaltyBps = p.royaltyBps;
        eventTime = p.eventTime;
    }

    // ---------------------------------------------------------------- primary sale

    /// @notice Buy `quantity` tickets at face value.
    /// @param quantity Number of tickets to mint to the caller.
    function buy(uint256 quantity) external payable {
        if (!tradingOpen()) revert TradingClosed();
        if (quantity == 0) revert InvalidQuantity();
        if (totalMinted + quantity > maxSupply) revert SoldOut(maxSupply - totalMinted);
        if (primaryPurchases[msg.sender] + quantity > maxPerWallet) {
            revert WalletLimitExceeded(maxPerWallet - primaryPurchases[msg.sender]);
        }
        uint256 cost = faceValue * quantity;
        if (msg.value != cost) revert WrongPayment(msg.value, cost);

        // Effects before minting (CEI).
        uint256 firstId = totalMinted + 1;
        totalMinted += quantity;
        primaryPurchases[msg.sender] += quantity;
        proceeds += msg.value;

        // _mint, not _safeMint: _safeMint calls back into the buyer (reentrancy path).
        for (uint256 i = 0; i < quantity; i++) {
            _mint(msg.sender, firstId + i);
        }
        emit TicketPurchased(msg.sender, firstId, quantity);
    }

    /// @notice Organizer withdraws primary sale proceeds.
    function withdrawProceeds() external onlyOrganizer nonReentrant {
        uint256 amount = proceeds;
        if (amount == 0) revert NoProceeds();
        proceeds = 0;
        (bool ok, ) = organizer.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit ProceedsWithdrawn(organizer, amount);
    }

    // ---------------------------------------------------------------- transfers

    /// @notice Move a ticket on behalf of the marketplace after a sale settles.
    /// @param from Current owner (seller).
    /// @param to New owner (buyer).
    /// @param id Token id.
    function marketplaceTransfer(address from, address to, uint256 id) external onlyMarketplace {
        // _transfer skips the approval check (the seller's listing is the authorization)
        // but still reverts if `from` is not the current owner.
        _transfer(from, to, id);
    }

    /// @dev Transfer lock: after mint, only the marketplace may move tokens.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        // In OZ v5 the previous owner is not a parameter, so read it first.
        // from == address(0) is a mint, which is always allowed.
        address from = _ownerOf(tokenId);
        if (from != address(0) && msg.sender != marketplace) revert TransfersDisabled();
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

    /// @notice True while primary sale and resale are allowed (before the event starts).
    function tradingOpen() public view returns (bool) {
        return block.timestamp < eventTime;
    }

    /// @notice True if the ticket exists, is unused, and the check-in window has not passed.
    ///         Lets any buyer verify a ticket before paying.
    /// @param id Token id.
    function isValid(uint256 id) external view returns (bool) {
        return _ownerOf(id) != address(0) && !used[id] && block.timestamp < eventTime + CHECKIN_WINDOW;
    }
}
