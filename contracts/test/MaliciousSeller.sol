// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ticket} from "../Ticket.sol";
import {Marketplace} from "../Marketplace.sol";

/// @title MaliciousSeller (test only)
/// @notice A seller contract that misbehaves when the marketplace pays it, used to test
///         the reentrancy guard and the atomicity of Marketplace.buy.
contract MaliciousSeller {
    enum Mode {
        Accept, // take the payment normally
        Reenter, // try to buy another listing from inside the payment callback
        Reject // refuse the payment
    }

    Ticket public immutable ticket;
    Marketplace public immutable marketplace;
    Mode public mode;
    uint256 public targetId;
    bool public reentryBlocked;

    constructor(Ticket ticket_, Marketplace marketplace_) {
        ticket = ticket_;
        marketplace = marketplace_;
    }

    /// @notice Buy one ticket at face value and list it.
    function buyAndList(uint256 price) external payable {
        ticket.buy{value: msg.value}(1);
        uint256 id = ticket.totalMinted();
        marketplace.list(address(ticket), id, price, address(0));
    }

    /// @notice Choose how to behave on the next payment.
    function setMode(Mode mode_, uint256 targetId_) external {
        mode = mode_;
        targetId = targetId_;
    }

    receive() external payable {
        if (mode == Mode.Reject) revert("no thanks");
        if (mode == Mode.Reenter) {
            mode = Mode.Accept;
            try marketplace.buy{value: address(this).balance}(address(ticket), targetId) {
                // Reentry succeeded: reentryBlocked stays false and the test fails.
            } catch {
                reentryBlocked = true;
            }
        }
    }
}
