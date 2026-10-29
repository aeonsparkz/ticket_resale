# Ticket Resale front end (demo)

React + Vite + ethers v6. It talks to a local Hardhat node. Stretch goal from `docs/SPEC.md` (D13).

## Run it

From the project root (`ticket_resale/`):

```shell
npx hardhat node                                            # terminal 1: local chain
npx hardhat run scripts/demo-setup.ts --network localhost   # terminal 2: deploy + demo event
cd frontend && npm install && npm run dev                   # terminal 2: http://localhost:5173
```

`demo-setup` deploys the factory and marketplace, creates the event "IS4302 Live 2027" (0.1 ETH, 110% cap, 5% royalty, starts in 7 days), appoints the Gate account, and writes `public/deployments.json`. Re-run it whenever you restart the node.

## Who you are

Pick a person under "Who are you?". The screen follows the role:

| Person | Role | Screen |
| --- | --- | --- |
| Organizer | runs the event | dashboard: sales, escrow, royalties, gate staff, cancel, new event |
| Gate staff | door scanner | scan a QR, see each check, big admit / do-not-admit result |
| Alice | fan who can't go | ticket wallet, sell (with payout breakdown), entry QR |
| Bob | met Alice on Telegram | resale market, buy (checks + what happens in the one transaction) |
| Mallory | scalper | same as a fan; use her to show the cheats failing |

These are the node's unlocked demo accounts, so there are no wallet popups and the entry QR re-signs itself every 30 seconds. "Use MetaMask instead" connects a real wallet (each QR refresh is then a signature popup; after restarting the node, clear MetaMask's activity data or it reuses stale nonces).

The URL remembers the person (`#as=Bob`), so two windows can play two people. The gate's "Scan QR on screen" picks up the QR a fan is showing in any window of the same browser. A real venue would use a camera.

Every failure is shown in plain English with the contract's error underneath, e.g. "That's above the organizer's resale cap… `PriceAboveCap(0.2 ETH, 0.11 ETH)`". The **Public activity** feed narrates the event's on-chain history. The **Demo time** bar at the bottom moves the chain's clock.

## Demo script (about 3 minutes)

1. **Alice:** buy 2 tickets. On ticket #1, **Sell** → "One specific buyer" → Bob. Point out the payout breakdown (royalty, what Alice receives).
2. **Mallory:** the market shows #1 "Reserved for Bob". Try to buy it → rejected. Sell one of hers above the cap → the dialog warns, the contract rejects it.
3. **Bob:** "Check the ticket first" shows it's genuine, owned by Alice, unused and reserved for him. **Buy** → the dialog lists the checks and the four things that happen in one transaction. Watch the balances and the activity feed.
4. **Bob:** **Show entry QR** (it rotates every 30s).
5. **Gate staff:** **Scan QR on screen** → all checks green → **Admit**. Scan again → red "Do not admit: already scanned in".
6. **Demo time → Skip to event start:** listings close; the **Organizer** can now withdraw the escrow.
7. Optional, on a new event (Organizer → **+ New event**): cancel it, then fans claim face value refunds.

## Files

- `src/web3.ts`: deployment loading, contracts, chain time, plain-English error messages, formatting
- `src/people.ts`: the demo cast (names, roles, hints)
- `src/App.tsx`: people picker, event picker, layout, toasts, polling
- `src/views/`: `FanView` + `fanDialogs` (sell, buy, entry QR), `OrganizerView` (+ create event), `GateView`
- `src/components/`: `EventHero`, `Activity` (on-chain feed), `DemoBar` (time travel), `TicketCheck`, `ui` (shared bits)
- `src/qrShare.ts`: hands the fan's current QR to the gate's simulated scanner
