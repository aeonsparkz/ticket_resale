# Scam-Proof Ticket Resale

NUS IS4302 group project. Every concert ticket is an ERC-721 token. Any resale, wherever buyer and seller met (Carousell, Telegram, …), settles through our Marketplace in **one atomic transaction**: the ticket goes to the buyer, payment to the seller and a royalty to the organizer, or nothing happens at all. The organizer sets a resale price cap that the contracts enforce. At the venue, a gate checks a rotating QR signed by the ticket's current owner.

## Contracts

| Contract | Role |
| --- | --- |
| `EventFactory.sol` | Organizers create events here. Deploys one `Ticket` contract per event and keeps the `isTicket` registry of genuine events. Deploys the single `Marketplace`. Enforces platform limits: cap 100–200% of face value, royalty ≤ 10%. |
| `Ticket.sol` | ERC-721 for one event. Primary sale with a per-wallet limit. Tickets can only move through the Marketplace. Trading closes at the event time, and unscanned tickets expire 12h later. Gate check-in verifies the holder's signature. Primary-sale money is escrowed until the event; if the organizer cancels, holders claim face value refunds. |
| `Marketplace.sol` | Public or private (one named buyer) listings at or below the cap. `buy` swaps ticket, payment and royalty atomically. It only trades tickets from factory-registered events. |

Built on [OpenZeppelin Contracts v5](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT): `ERC721`, `ReentrancyGuard`, `ECDSA`, `MessageHashUtils`.

## Run the tests

```shell
npm install
npx hardhat test
```

There are 72 mocha tests in `test/`, covering the factory, primary sale, transfer lock, listing, purchase and royalty split, private listings, reentrancy and atomicity attacks, signed check-in, time rules, cancellation refunds and end-to-end flows.

## Run the demo front end

```shell
npx hardhat node                                            # terminal 1
npx hardhat run scripts/demo-setup.ts --network localhost   # terminal 2
cd frontend && npm install && npm run dev                   # open http://localhost:5173
```

See [`frontend/README.md`](frontend/README.md) for the accounts and a step-by-step demo.

## Deploy

```shell
npx hardhat ignition deploy ignition/modules/TicketResale.ts                    # in-memory chain
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npx hardhat ignition deploy ignition/modules/TicketResale.ts --network sepolia
```

## Stack

Hardhat 3, Solidity 0.8.34, TypeScript, mocha + chai, ethers v6. The front end uses React + Vite.
