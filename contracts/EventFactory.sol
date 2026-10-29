// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ticket, EventParams} from "./Ticket.sol";
import {Marketplace} from "./Marketplace.sol";

/// @title EventFactory
/// @notice Organizers create events here. Each event gets its own Ticket contract,
///         and the factory keeps the registry of genuine Ticket contracts.
contract EventFactory {
    uint16 public constant MIN_RESALE_CAP_BPS = 10_000; // 100% of face value
    uint16 public constant MAX_RESALE_CAP_BPS = 20_000; // 200% of face value
    uint16 public constant MAX_ROYALTY_BPS = 1_000; // 10%

    Marketplace public immutable marketplace;

    mapping(address => bool) public isTicket;
    address[] private allEvents;
    mapping(address => address[]) private eventsByOrganizer;

    event EventCreated(
        address indexed ticket,
        address indexed organizer,
        uint256 faceValue,
        uint32 maxSupply,
        uint16 resaleCapBps,
        uint16 royaltyBps,
        uint64 eventTime
    );

    error InvalidParams();
    error CapOutOfBounds(uint16 resaleCapBps);
    error RoyaltyTooHigh(uint16 royaltyBps);
    error EventTimeInPast(uint64 eventTime);

    constructor() {
        marketplace = new Marketplace(address(this));
    }

    /// @notice Create a new event and deploy its Ticket contract. Caller becomes the organizer.
    /// @param p Event parameters (see `EventParams` in Ticket.sol).
    /// @return ticket Address of the new Ticket contract.
    function createEvent(EventParams calldata p) external returns (address ticket) {
        if (p.faceValue == 0 || p.maxSupply == 0 || p.maxPerWallet == 0) revert InvalidParams();
        if (p.resaleCapBps < MIN_RESALE_CAP_BPS || p.resaleCapBps > MAX_RESALE_CAP_BPS) {
            revert CapOutOfBounds(p.resaleCapBps);
        }
        if (p.royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(p.royaltyBps);
        if (p.eventTime <= block.timestamp) revert EventTimeInPast(p.eventTime);

        ticket = address(new Ticket(p, address(marketplace), msg.sender));

        isTicket[ticket] = true;
        allEvents.push(ticket);
        eventsByOrganizer[msg.sender].push(ticket);

        emit EventCreated(ticket, msg.sender, p.faceValue, p.maxSupply, p.resaleCapBps, p.royaltyBps, p.eventTime);
    }

    /// @notice All Ticket contracts ever created.
    function getAllEvents() external view returns (address[] memory) {
        return allEvents;
    }

    /// @notice Ticket contracts created by `organizer`.
    /// @param organizer Organizer address.
    function getEventsByOrganizer(address organizer) external view returns (address[] memory) {
        return eventsByOrganizer[organizer];
    }
}
