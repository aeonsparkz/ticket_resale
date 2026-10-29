import { expect } from "chai";
import { deployFixture, ethers, networkHelpers, FACE_VALUE, CHECKIN_WINDOW } from "./fixtures.js";

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
});
