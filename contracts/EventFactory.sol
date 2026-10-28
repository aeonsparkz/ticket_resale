// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ticket} from "./Ticket.sol";
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
        uint16 royaltyBps
    );

    error InvalidParams();
    error CapOutOfBounds(uint16 resaleCapBps);
    error RoyaltyTooHigh(uint16 royaltyBps);

    constructor() {
        marketplace = new Marketplace(address(this));
    }

    /// @notice Create a new event and deploy its Ticket contract. Caller becomes the organizer.
    /// @param name ERC-721 name, e.g. "Coldplay SG 2027".
    /// @param symbol ERC-721 symbol.
    /// @param faceValue Primary price per ticket in wei.
    /// @param maxSupply Total tickets available.
    /// @param maxPerWallet Max primary purchases per wallet.
    /// @param resaleCapBps Resale cap as basis points of face value (10_000 = 100%).
    /// @param royaltyBps Organizer royalty on resale in basis points.
    /// @return ticket Address of the new Ticket contract.
    function createEvent(
        string calldata name,
        string calldata symbol,
        uint256 faceValue,
        uint32 maxSupply,
        uint16 maxPerWallet,
        uint16 resaleCapBps,
        uint16 royaltyBps
    ) external returns (address ticket) {
        if (faceValue == 0 || maxSupply == 0 || maxPerWallet == 0) revert InvalidParams();
        if (resaleCapBps < MIN_RESALE_CAP_BPS || resaleCapBps > MAX_RESALE_CAP_BPS) {
            revert CapOutOfBounds(resaleCapBps);
        }
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(royaltyBps);

        ticket = address(
            new Ticket(
                name,
                symbol,
                address(marketplace),
                msg.sender,
                faceValue,
                maxSupply,
                maxPerWallet,
                resaleCapBps,
                royaltyBps
            )
        );

        isTicket[ticket] = true;
        allEvents.push(ticket);
        eventsByOrganizer[msg.sender].push(ticket);

        emit EventCreated(ticket, msg.sender, faceValue, maxSupply, resaleCapBps, royaltyBps);
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
