import { expect } from "chai";
import { deployFixture, ethers, networkHelpers, signCheckIn, FACE_VALUE, ROYALTY_BPS } from "./fixtures.js";

describe("End-to-end", function () {
  it("buy → private resale to a stranger → check-in → no further resale", async function () {
    const { factory, marketplace, ticket, organizer, gate, fan1, fan2, attacker } =
      await networkHelpers.loadFixture(deployFixture);
    const ticketAddr = await ticket.getAddress();

    // 1. A buyer found on Telegram can verify the ticket contract is genuine before anything happens.
    expect(await factory.isTicket(ticketAddr)).to.equal(true);

    // 2. fan1 buys a ticket at face value.
    await ticket.connect(fan1).buy(1, { value: FACE_VALUE });
    expect(await ticket.isValid(1n)).to.equal(true);

    // 3. fan1 can't go; agrees a deal with fan2 off-chain and lists privately for fan2 at the cap.
    const price = await ticket.maxResalePrice();
    await marketplace.connect(fan1).list(ticketAddr, 1n, price, fan2.address);

    // A third party can't snipe the private listing.
    await expect(marketplace.connect(attacker).buy(ticketAddr, 1n, { value: price }))
      .to.be.revertedWithCustomError(marketplace, "NotAllowedBuyer");

    // 4. fan2 pays; ticket, payment and royalty settle in one transaction.
    const royalty = (price * BigInt(ROYALTY_BPS)) / 10_000n;
    await expect(marketplace.connect(fan2).buy(ticketAddr, 1n, { value: price })).to.changeEtherBalances(
      ethers,
      [fan2, fan1, organizer, marketplace],
      [-price, price - royalty, royalty, 0n],
    );
    expect(await ticket.ownerOf(1n)).to.equal(fan2.address);

    // 5. The event starts; the organizer can now collect the escrowed primary sale proceeds.
    const eventTime = Number(await ticket.eventTime());
    await networkHelpers.time.increaseTo(eventTime + 60);
    await expect(ticket.connect(organizer).withdrawProceeds()).to.changeEtherBalance(ethers, organizer, FACE_VALUE);

    // 6. Event night: fan1's old QR is useless; fan2's fresh QR gets in.
    const validUntil = (await networkHelpers.time.latest()) + 30;
    const oldSig = await signCheckIn(fan1, ticketAddr, 1n, validUntil);
    await expect(ticket.connect(gate).checkIn(1n, validUntil, oldSig))
      .to.be.revertedWithCustomError(ticket, "NotHolder");
    const sig = await signCheckIn(fan2, ticketAddr, 1n, validUntil);
    await expect(ticket.connect(gate).checkIn(1n, validUntil, sig))
      .to.emit(ticket, "CheckedIn")
      .withArgs(1n, fan2.address);

    // 7. The used ticket can't be scanned again, resold or transferred.
    await expect(ticket.connect(gate).checkIn(1n, validUntil, sig))
      .to.be.revertedWithCustomError(ticket, "AlreadyCheckedIn");
    await expect(marketplace.connect(fan2).list(ticketAddr, 1n, price, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(marketplace, "TradingClosed");
    await expect(ticket.connect(fan2).transferFrom(fan2.address, attacker.address, 1n))
      .to.be.revertedWithCustomError(ticket, "TransfersDisabled");
    expect(await ticket.isValid(1n)).to.equal(false);
  });

  it("an unscanned ticket is dead after the event", async function () {
    const { marketplace, ticket, gate, fan1, fan2, eventTime } = await networkHelpers.loadFixture(deployFixture);
    const ticketAddr = await ticket.getAddress();
    const price = await ticket.maxResalePrice();

    await ticket.connect(fan1).buy(1, { value: FACE_VALUE });
    await marketplace.connect(fan1).list(ticketAddr, 1n, price, ethers.ZeroAddress);

    // The concert has started: the stale listing can't be bought and no new listing can be made.
    await networkHelpers.time.increaseTo(eventTime);
    await expect(marketplace.connect(fan2).buy(ticketAddr, 1n, { value: price }))
      .to.be.revertedWithCustomError(marketplace, "TradingClosed");
    await expect(marketplace.connect(fan1).list(ticketAddr, 1n, price, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(marketplace, "TradingClosed");
    expect(await ticket.isValid(1n)).to.equal(true); // still usable at the gate tonight

    // The check-in window closes: the ticket is expired and can't be scanned.
    await networkHelpers.time.increaseTo(eventTime + 12 * 60 * 60);
    expect(await ticket.isValid(1n)).to.equal(false);
    const validUntil = (await networkHelpers.time.latest()) + 30;
    const sig = await signCheckIn(fan1, ticketAddr, 1n, validUntil);
    await expect(ticket.connect(gate).checkIn(1n, validUntil, sig))
      .to.be.revertedWithCustomError(ticket, "CheckInClosed");

    // The seller can still clear the stale listing.
    await expect(marketplace.connect(fan1).cancel(ticketAddr, 1n)).to.emit(marketplace, "Cancelled");
  });

  it("organizer cancels → every holder, including a resale buyer, gets face value back", async function () {
    const { marketplace, ticket, organizer, fan1, fan2 } = await networkHelpers.loadFixture(deployFixture);
    const ticketAddr = await ticket.getAddress();
    const price = await ticket.maxResalePrice();

    await ticket.connect(fan1).buy(2, { value: FACE_VALUE * 2n });
    await marketplace.connect(fan1).list(ticketAddr, 2n, price, fan2.address);
    await marketplace.connect(fan2).buy(ticketAddr, 2n, { value: price });

    await ticket.connect(organizer).cancelEvent();
    await expect(ticket.connect(fan1).claimRefund(1n)).to.changeEtherBalance(ethers, fan1, FACE_VALUE);
    await expect(ticket.connect(fan2).claimRefund(2n)).to.changeEtherBalance(ethers, fan2, FACE_VALUE);
    expect(await ticket.proceeds()).to.equal(0n);
  });
});
