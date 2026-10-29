import { expect } from "chai";
import {
  deployFixture,
  ethers,
  eventParams,
  networkHelpers,
  signCheckIn,
  FACE_VALUE,
  CHECKIN_WINDOW,
} from "./fixtures.js";

describe("Ticket", function () {
  let f: Awaited<ReturnType<typeof deployFixture>>;

  beforeEach(async function () {
    f = await networkHelpers.loadFixture(deployFixture);
  });

  describe("primary sale", function () {
    it("mints sequential ids from 1 and takes payment", async function () {
      const { ticket, fan1 } = f;
      const tx = ticket.connect(fan1).buy(2, { value: FACE_VALUE * 2n });

      await expect(tx).to.emit(ticket, "TicketPurchased").withArgs(fan1.address, 1n, 2n);
      await expect(tx).to.changeEtherBalances(ethers, [fan1, ticket], [-FACE_VALUE * 2n, FACE_VALUE * 2n]);

      expect(await ticket.ownerOf(1n)).to.equal(fan1.address);
      expect(await ticket.ownerOf(2n)).to.equal(fan1.address);
      expect(await ticket.totalMinted()).to.equal(2n);
      expect(await ticket.primaryPurchases(fan1.address)).to.equal(2n);
      expect(await ticket.proceeds()).to.equal(FACE_VALUE * 2n);
    });

    it("reverts on wrong payment", async function () {
      const { ticket, fan1 } = f;
      await expect(ticket.connect(fan1).buy(1, { value: FACE_VALUE - 1n }))
        .to.be.revertedWithCustomError(ticket, "WrongPayment")
        .withArgs(FACE_VALUE - 1n, FACE_VALUE);
      await expect(ticket.connect(fan1).buy(1, { value: FACE_VALUE * 2n }))
        .to.be.revertedWithCustomError(ticket, "WrongPayment");
    });

    it("reverts on zero quantity", async function () {
      await expect(f.ticket.connect(f.fan1).buy(0)).to.be.revertedWithCustomError(f.ticket, "InvalidQuantity");
    });

    it("reverts when sold out", async function () {
      const { ticket, fan1, fan2, attacker } = f; // max supply 5, max 2 per wallet
      await ticket.connect(fan1).buy(2, { value: FACE_VALUE * 2n });
      await ticket.connect(fan2).buy(2, { value: FACE_VALUE * 2n });
      await expect(ticket.connect(attacker).buy(2, { value: FACE_VALUE * 2n }))
        .to.be.revertedWithCustomError(ticket, "SoldOut")
        .withArgs(1n);
      await ticket.connect(attacker).buy(1, { value: FACE_VALUE }); // the last one is still buyable
      expect(await ticket.totalMinted()).to.equal(5n);
    });

    it("enforces the per-wallet limit across purchases", async function () {
      const { ticket, fan1 } = f;
      await ticket.connect(fan1).buy(1, { value: FACE_VALUE });
      await ticket.connect(fan1).buy(1, { value: FACE_VALUE });
      await expect(ticket.connect(fan1).buy(1, { value: FACE_VALUE }))
        .to.be.revertedWithCustomError(ticket, "WalletLimitExceeded")
        .withArgs(0n);
    });

    it("closes at eventTime", async function () {
      const { ticket, fan1, eventTime } = f;
      expect(await ticket.tradingOpen()).to.equal(true);
      await networkHelpers.time.increaseTo(eventTime);
      expect(await ticket.tradingOpen()).to.equal(false);
      await expect(ticket.connect(fan1).buy(1, { value: FACE_VALUE }))
        .to.be.revertedWithCustomError(ticket, "TradingClosed");
    });
  });

  describe("proceeds", function () {
    it("organizer withdraws primary sale proceeds", async function () {
      const { ticket, organizer, fan1 } = f;
      await ticket.connect(fan1).buy(2, { value: FACE_VALUE * 2n });

      const tx = ticket.connect(organizer).withdrawProceeds();
      await expect(tx).to.emit(ticket, "ProceedsWithdrawn").withArgs(organizer.address, FACE_VALUE * 2n);
      await expect(tx).to.changeEtherBalances(ethers, [organizer, ticket], [FACE_VALUE * 2n, -FACE_VALUE * 2n]);
      expect(await ticket.proceeds()).to.equal(0n);
    });

    it("non-organizer cannot withdraw", async function () {
      const { ticket, fan1 } = f;
      await ticket.connect(fan1).buy(1, { value: FACE_VALUE });
      await expect(ticket.connect(fan1).withdrawProceeds()).to.be.revertedWithCustomError(ticket, "NotOrganizer");
    });

    it("reverts when there is nothing to withdraw", async function () {
      await expect(f.ticket.connect(f.organizer).withdrawProceeds())
        .to.be.revertedWithCustomError(f.ticket, "NoProceeds");
    });
  });

  describe("transfer lock", function () {
    beforeEach(async function () {
      await f.ticket.connect(f.fan1).buy(1, { value: FACE_VALUE });
    });

    it("owner cannot transferFrom or safeTransferFrom", async function () {
      const { ticket, fan1, fan2 } = f;
      await expect(ticket.connect(fan1).transferFrom(fan1.address, fan2.address, 1n))
        .to.be.revertedWithCustomError(ticket, "TransfersDisabled");
      await expect(
        ticket.connect(fan1)["safeTransferFrom(address,address,uint256)"](fan1.address, fan2.address, 1n),
      ).to.be.revertedWithCustomError(ticket, "TransfersDisabled");
    });

    it("approved operator cannot transfer either", async function () {
      const { ticket, fan1, attacker } = f;
      await ticket.connect(fan1).approve(attacker.address, 1n);
      await expect(ticket.connect(attacker).transferFrom(fan1.address, attacker.address, 1n))
        .to.be.revertedWithCustomError(ticket, "TransfersDisabled");
    });

    it("only the marketplace can call marketplaceTransfer", async function () {
      const { ticket, fan1, attacker } = f;
      await expect(ticket.connect(attacker).marketplaceTransfer(fan1.address, attacker.address, 1n))
        .to.be.revertedWithCustomError(ticket, "NotMarketplace");
    });

    it("the marketplace can move a ticket", async function () {
      const { ticket, marketplace, fan1, fan2 } = f;
      // Impersonate the marketplace contract to test Ticket in isolation (Marketplace.buy comes in step 3).
      const mktAddr = await marketplace.getAddress();
      await networkHelpers.impersonateAccount(mktAddr);
      await networkHelpers.setBalance(mktAddr, ethers.parseEther("1"));
      const mkt = await ethers.getSigner(mktAddr);

      await ticket.connect(mkt).marketplaceTransfer(fan1.address, fan2.address, 1n);
      expect(await ticket.ownerOf(1n)).to.equal(fan2.address);

      // `from` must be the real owner.
      await expect(ticket.connect(mkt).marketplaceTransfer(fan1.address, fan2.address, 1n))
        .to.be.revertedWithCustomError(ticket, "ERC721IncorrectOwner");
    });
  });

  describe("validity and expiry", function () {
    it("isValid tracks existence and the check-in window", async function () {
      const { ticket, fan1, eventTime } = f;
      expect(await ticket.isValid(1n)).to.equal(false); // not minted yet
      await ticket.connect(fan1).buy(1, { value: FACE_VALUE });
      expect(await ticket.isValid(1n)).to.equal(true);

      await networkHelpers.time.increaseTo(eventTime + CHECKIN_WINDOW - 1);
      expect(await ticket.isValid(1n)).to.equal(true); // after the event starts, still inside the window

      await networkHelpers.time.increaseTo(eventTime + CHECKIN_WINDOW);
      expect(await ticket.isValid(1n)).to.equal(false); // expired, never scanned
    });
  });

  describe("check-in", function () {
    let ticketAddr: string;
    let validUntil: number;

    // fan1 holds tickets #1 and #2; the QR is valid for 30 seconds.
    beforeEach(async function () {
      await f.ticket.connect(f.fan1).buy(2, { value: FACE_VALUE * 2n });
      ticketAddr = await f.ticket.getAddress();
      validUntil = (await networkHelpers.time.latest()) + 30;
    });

    it("checks in with a valid holder signature", async function () {
      const { ticket, gate, fan1 } = f;
      const sig = await signCheckIn(fan1, ticketAddr, 1n, validUntil);
      await expect(ticket.connect(gate).checkIn(1n, validUntil, sig))
        .to.emit(ticket, "CheckedIn")
        .withArgs(1n, fan1.address);
      expect(await ticket.used(1n)).to.equal(true);
      expect(await ticket.isValid(1n)).to.equal(false);
      expect(await ticket.isValid(2n)).to.equal(true); // other tickets unaffected
    });

    it("rejects a double check-in", async function () {
      const { ticket, gate, fan1 } = f;
      const sig = await signCheckIn(fan1, ticketAddr, 1n, validUntil);
      await ticket.connect(gate).checkIn(1n, validUntil, sig);
      await expect(ticket.connect(gate).checkIn(1n, validUntil, sig))
        .to.be.revertedWithCustomError(ticket, "AlreadyCheckedIn")
        .withArgs(1n);
    });

    it("only an appointed gate can check in", async function () {
      const { ticket, fan1, attacker } = f;
      const sig = await signCheckIn(fan1, ticketAddr, 1n, validUntil);
      await expect(ticket.connect(attacker).checkIn(1n, validUntil, sig))
        .to.be.revertedWithCustomError(ticket, "NotGate");
    });

    it("a revoked gate cannot check in", async function () {
      const { ticket, organizer, gate, fan1 } = f;
      await expect(ticket.connect(organizer).setGate(gate.address, false))
        .to.emit(ticket, "GateSet")
        .withArgs(gate.address, false);
      const sig = await signCheckIn(fan1, ticketAddr, 1n, validUntil);
      await expect(ticket.connect(gate).checkIn(1n, validUntil, sig))
        .to.be.revertedWithCustomError(ticket, "NotGate");
    });

    it("only the organizer can appoint gates", async function () {
      const { ticket, attacker } = f;
      await expect(ticket.connect(attacker).setGate(attacker.address, true))
        .to.be.revertedWithCustomError(ticket, "NotOrganizer");
    });

    it("rejects an expired QR signature", async function () {
      const { ticket, gate, fan1 } = f;
      const sig = await signCheckIn(fan1, ticketAddr, 1n, validUntil);
      await networkHelpers.time.increaseTo(validUntil + 1);
      await expect(ticket.connect(gate).checkIn(1n, validUntil, sig))
        .to.be.revertedWithCustomError(ticket, "SignatureExpired")
        .withArgs(validUntil);
    });

    it("rejects a signature from someone who does not hold the ticket", async function () {
      const { ticket, gate, attacker } = f;
      const sig = await signCheckIn(attacker, ticketAddr, 1n, validUntil);
      await expect(ticket.connect(gate).checkIn(1n, validUntil, sig))
        .to.be.revertedWithCustomError(ticket, "NotHolder")
        .withArgs(attacker.address);
    });

    it("rejects a signature made for another token", async function () {
      const { ticket, gate, fan1 } = f;
      const sigFor2 = await signCheckIn(fan1, ticketAddr, 2n, validUntil);
      await expect(ticket.connect(gate).checkIn(1n, validUntil, sigFor2))
        .to.be.revertedWithCustomError(ticket, "NotHolder");
    });

    it("rejects a signature made for another event's contract", async function () {
      const { factory, ticket, organizer, gate, fan1, eventTime } = f;
      await factory.connect(organizer).createEvent(eventParams(eventTime));
      const [, otherAddr] = await factory.getEventsByOrganizer(organizer.address);
      const sigForOther = await signCheckIn(fan1, otherAddr, 1n, validUntil);
      await expect(ticket.connect(gate).checkIn(1n, validUntil, sigForOther))
        .to.be.revertedWithCustomError(ticket, "NotHolder");
    });

    it("the previous owner's QR stops working after a resale", async function () {
      const { ticket, marketplace, gate, fan1, fan2 } = f;
      const oldSig = await signCheckIn(fan1, ticketAddr, 1n, validUntil + 3600);
      const price = await ticket.maxResalePrice();
      await marketplace.connect(fan1).list(ticketAddr, 1n, price, ethers.ZeroAddress);
      await marketplace.connect(fan2).buy(ticketAddr, 1n, { value: price });

      await expect(ticket.connect(gate).checkIn(1n, validUntil + 3600, oldSig))
        .to.be.revertedWithCustomError(ticket, "NotHolder")
        .withArgs(fan1.address);
      const newSig = await signCheckIn(fan2, ticketAddr, 1n, validUntil + 3600);
      await expect(ticket.connect(gate).checkIn(1n, validUntil + 3600, newSig)).to.emit(ticket, "CheckedIn");
    });

    it("allows check-in after eventTime but inside the window", async function () {
      const { ticket, gate, fan1, eventTime } = f;
      await networkHelpers.time.increaseTo(eventTime + CHECKIN_WINDOW - 60);
      const qrExpiry = (await networkHelpers.time.latest()) + 30;
      const sig = await signCheckIn(fan1, ticketAddr, 1n, qrExpiry);
      await expect(ticket.connect(gate).checkIn(1n, qrExpiry, sig)).to.emit(ticket, "CheckedIn");
    });

    it("rejects check-in after the window", async function () {
      const { ticket, gate, fan1, eventTime } = f;
      await networkHelpers.time.increaseTo(eventTime + CHECKIN_WINDOW);
      const qrExpiry = (await networkHelpers.time.latest()) + 30;
      const sig = await signCheckIn(fan1, ticketAddr, 1n, qrExpiry);
      await expect(ticket.connect(gate).checkIn(1n, qrExpiry, sig))
        .to.be.revertedWithCustomError(ticket, "CheckInClosed");
    });
  });
});
