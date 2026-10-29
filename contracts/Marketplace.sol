// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ticket} from "./Ticket.sol";

interface IEventFactory {
    function isTicket(address ticket) external view returns (bool);
}

/// @title Marketplace
/// @notice Resale of Ticket tokens. Each purchase atomically moves the ticket to the
///         buyer, pays the seller, and pays the organizer's royalty.
contract Marketplace is ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
        address allowedBuyer; // address(0) = anyone may buy
    }

    IEventFactory public immutable factory;

    mapping(address ticket => mapping(uint256 id => Listing)) private listings;

    event Listed(address indexed ticket, uint256 indexed id, address indexed seller, uint256 price, address allowedBuyer);
    event Cancelled(address indexed ticket, uint256 indexed id);
    event Sold(
        address indexed ticket,
        uint256 indexed id,
        address seller,
        address indexed buyer,
        uint256 price,
        uint256 royalty
    );

    error NotSeller();
    error NotListed();
    error UnregisteredTicket(address ticket);
    error TradingClosed();
    error NotTicketOwner();
    error TicketUsed();
    error ZeroPrice();
    error PriceAboveCap(uint256 price, uint256 cap);
    error WrongPayment(uint256 sent, uint256 expected);
    error CannotBuyOwnListing();
    error NotAllowedBuyer();
    error TransferFailed();

    constructor(address factory_) {
        factory = IEventFactory(factory_);
    }

    /// @notice List a ticket for resale at or below its cap. The ticket stays in the
    ///         seller's wallet (no escrow). Listing again overwrites the old listing.
    /// @param ticket Ticket contract (must be registered with the factory).
    /// @param id Token id.
    /// @param price Asking price in wei.
    /// @param allowedBuyer Restrict sale to this address, or address(0) for a public listing.
    function list(address ticket, uint256 id, uint256 price, address allowedBuyer) external {
        // Contract register: without this, a scammer could deploy a look-alike Ticket and sell it here.
        if (!factory.isTicket(ticket)) revert UnregisteredTicket(ticket);
        Ticket t = Ticket(ticket);
        if (!t.tradingOpen()) revert TradingClosed();
        if (t.ownerOf(id) != msg.sender) revert NotTicketOwner();
        if (t.used(id)) revert TicketUsed();
        if (price == 0) revert ZeroPrice();
        uint256 cap = t.maxResalePrice();
        if (price > cap) revert PriceAboveCap(price, cap);

        listings[ticket][id] = Listing(msg.sender, price, allowedBuyer);
        emit Listed(ticket, id, msg.sender, price, allowedBuyer);
    }

    /// @notice Cancel your own listing. Allowed at any time, so stale listings can be cleared.
    /// @param ticket Ticket contract.
    /// @param id Token id.
    function cancel(address ticket, uint256 id) external {
        Listing storage l = listings[ticket][id];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[ticket][id];
        emit Cancelled(ticket, id);
    }

    /// @notice Buy a listed ticket. Ticket, payment and royalty settle in this one call:
    ///         if any part fails, the whole purchase reverts.
    /// @param ticket Ticket contract.
    /// @param id Token id.
    function buy(address ticket, uint256 id) external payable nonReentrant {
        // Checks. A listing can only exist for a registered ticket (checked in `list`).
        Listing memory l = listings[ticket][id];
        if (l.seller == address(0)) revert NotListed();
        Ticket t = Ticket(ticket);
        if (!t.tradingOpen()) revert TradingClosed();
        if (msg.value != l.price) revert WrongPayment(msg.value, l.price);
        if (msg.sender == l.seller) revert CannotBuyOwnListing();
        if (l.allowedBuyer != address(0) && l.allowedBuyer != msg.sender) revert NotAllowedBuyer();
        if (t.ownerOf(id) != l.seller) revert NotTicketOwner();
        if (t.used(id)) revert TicketUsed();

        // Effects.
        delete listings[ticket][id];

        // Interactions. Royalty rounds down, so royalty + seller payout == price exactly.
        uint256 royalty = (l.price * t.royaltyBps()) / 10_000;
        t.marketplaceTransfer(l.seller, msg.sender, id);
        _pay(t.organizer(), royalty);
        _pay(l.seller, l.price - royalty);

        emit Sold(ticket, id, l.seller, msg.sender, l.price, royalty);
    }

    /// @notice Read a listing. Returns an empty struct if not listed.
    /// @param ticket Ticket contract.
    /// @param id Token id.
    function getListing(address ticket, uint256 id) external view returns (Listing memory) {
        return listings[ticket][id];
    }

    /// @dev Push payment (D8). A failed send reverts the whole purchase.
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
