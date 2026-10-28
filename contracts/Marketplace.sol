// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

    error NotImplemented();
    error NotSeller();
    error NotListed();

    constructor(address factory_) {
        factory = IEventFactory(factory_);
    }

    /// @notice List a ticket for resale at or below its cap.
    /// @param ticket Ticket contract (must be registered with the factory).
    /// @param id Token id.
    /// @param price Asking price in wei.
    /// @param allowedBuyer Restrict sale to this address, or address(0) for a public listing.
    function list(address ticket, uint256 id, uint256 price, address allowedBuyer) external {
        // TODO: isTicket, caller owns, !used, 0 < price <= maxResalePrice; store + emit Listed
        revert NotImplemented();
    }

    /// @notice Cancel your own listing.
    /// @param ticket Ticket contract.
    /// @param id Token id.
    function cancel(address ticket, uint256 id) external {
        Listing storage l = listings[ticket][id];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[ticket][id];
        emit Cancelled(ticket, id);
    }

    /// @notice Buy a listed ticket. Ticket, payment and royalty settle in this one call.
    /// @param ticket Ticket contract.
    /// @param id Token id.
    function buy(address ticket, uint256 id) external payable nonReentrant {
        // TODO: checks (value, seller still owns, !used, allowedBuyer, not self-buy)
        //       effects (delete listing)
        //       interactions (marketplaceTransfer, pay royalty to organizer, rest to seller); emit Sold
        revert NotImplemented();
    }

    /// @notice Read a listing. Returns an empty struct if not listed.
    /// @param ticket Ticket contract.
    /// @param id Token id.
    function getListing(address ticket, uint256 id) external view returns (Listing memory) {
        return listings[ticket][id];
    }
}
