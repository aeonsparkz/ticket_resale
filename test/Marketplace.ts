import { expect } from "chai";
import { deployFixture, ethers, eventParams, networkHelpers, FACE_VALUE, ROYALTY_BPS } from "./fixtures.js";

const CAP = (FACE_VALUE * 11_000n) / 10_000n; // 0.11 ETH
const royaltyOf = (price: bigint) => (price * BigInt(ROYALTY_BPS)) / 10_000n;

describe("Marketplace", function () {
  let f: Awaited<ReturnType<typeof deployFixture>>;
  let ticketAddr: string;

  // Every test starts with fan1 holding ticket #1.
  beforeEach(async function () {
    f = await networkHelpers.loadFixture(deployFixture);
    ticketAddr = await f.ticket.getAddress();
    await f.ticket.connect(f.fan1).buy(1, { value: FACE_VALUE });
  });

  describe("list", function () {
    it("owner lists at the cap and below", async function () {
      const { marketplace, fan1 } = f;
      await expect(marketplace.connect(fan1).list(ticketAddr, 1n, CAP, ethers.ZeroAddress))
        .to.emit(marketplace, "Listed")
        .withArgs(ticketAddr, 1n, fan1.address, CAP, ethers.ZeroAddress);

      await marketplace.connect(fan1).list(ticketAddr, 1n, FACE_VALUE / 2n, ethers.ZeroAddress);
      const l = await marketplace.getListing(ticketAddr, 1n);
      expect(l.seller).to.equal(fan1.address);
      expect(l.price).to.equal(FACE_VALUE / 2n); // relisting updates the price
    });

    it("rejects a price above the cap", async function () {
      const { marketplace, fan1 } = f;
      await expect(marketplace.connect(fan1).list(ticketAddr, 1n, CAP + 1n, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(marketplace, "PriceAboveCap")
        .withArgs(CAP + 1n, CAP);
    });

    it("rejects a zero price", async function () {
      const { marketplace, fan1 } = f;
      await expect(marketplace.connect(fan1).list(ticketAddr, 1n, 0n, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(marketplace, "ZeroPrice");
    });

    it("rejects a non-owner", async function () {
      const { marketplace, attacker } = f;
      await expect(marketplace.connect(attacker).list(ticketAddr, 1n, CAP, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(marketplace, "NotTicketOwner");
    });

    it("rejects a fake Ticket contract not created by the factory", async function () {
      const { marketplace, attacker, eventTime } = f;
      // The attacker deploys a real-looking Ticket directly, with themselves as organizer.
      const fake = await ethers.deployContract("Ticket", [
        eventParams(eventTime),
        await marketplace.getAddress(),
        attacker.address,
      ]);
      await fake.connect(attacker).buy(1, { value: FACE_VALUE });

      await expect(marketplace.connect(attacker).list(await fake.getAddress(), 1n, CAP, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(marketplace, "UnregisteredTicket")
        .withArgs(await fake.getAddress());
    });

    it("rejects listing at or after eventTime", async function () {
      const { marketplace, fan1, eventTime } = f;
      await networkHelpers.time.increaseTo(eventTime);
      await expect(marketplace.connect(fan1).list(ticketAddr, 1n, CAP, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(marketplace, "TradingClosed");
    });
  });

  describe("cancel", function () {
    beforeEach(async function () {
      await f.marketplace.connect(f.fan1).list(ticketAddr, 1n, CAP, ethers.ZeroAddress);
    });

    it("seller cancels and the listing is removed", async function () {
      const { marketplace, fan1 } = f;
      await expect(marketplace.connect(fan1).cancel(ticketAddr, 1n))
        .to.emit(marketplace, "Cancelled")
        .withArgs(ticketAddr, 1n);
      expect((await marketplace.getListing(ticketAddr, 1n)).seller).to.equal(ethers.ZeroAddress);
    });

    it("non-seller cannot cancel", async function () {
      const { marketplace, attacker } = f;
      await expect(marketplace.connect(attacker).cancel(ticketAddr, 1n))
        .to.be.revertedWithCustomError(marketplace, "NotSeller");
    });

    it("cancelling a missing listing reverts", async function () {
      const { marketplace, fan1 } = f;
      await expect(marketplace.connect(fan1).cancel(ticketAddr, 99n))
        .to.be.revertedWithCustomError(marketplace, "NotListed");
    });

    it("seller can still cancel after eventTime", async function () {
      const { marketplace, fan1, eventTime } = f;
      await networkHelpers.time.increaseTo(eventTime);
      await expect(marketplace.connect(fan1).cancel(ticketAddr, 1n)).to.emit(marketplace, "Cancelled");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      await f.marketplace.connect(f.fan1).list(ticketAddr, 1n, CAP, ethers.ZeroAddress);
    });

    it("moves the ticket, pays the seller and the organizer royalty in one tx", async function () {
      const { marketplace, ticket, organizer, fan1, fan2 } = f;
      const royalty = royaltyOf(CAP);
      const tx = marketplace.connect(fan2).buy(ticketAddr, 1n, { value: CAP });

      await expect(tx)
        .to.emit(marketplace, "Sold")
        .withArgs(ticketAddr, 1n, fan1.address, fan2.address, CAP, royalty);
      // The marketplace's balance is unchanged: it never keeps sale funds.
      await expect(tx).to.changeEtherBalances(
        ethers,
        [fan2, fan1, organizer, marketplace],
        [-CAP, CAP - royalty, royalty, 0n],
      );
      expect(await ticket.ownerOf(1n)).to.equal(fan2.address);
    });

    it("royalty rounds down and the payouts sum exactly to the price", async function () {
      const { marketplace, organizer, fan1, fan2 } = f;
      const price = FACE_VALUE + 19n; // 5% of this is not a whole number of wei
      await marketplace.connect(fan1).list(ticketAddr, 1n, price, ethers.ZeroAddress);
      const royalty = royaltyOf(price);
      expect(royalty * 10_000n).to.be.lessThan(price * BigInt(ROYALTY_BPS)); // it really did round

      await expect(marketplace.connect(fan2).buy(ticketAddr, 1n, { value: price })).to.changeEtherBalances(
        ethers,
        [fan2, fan1, organizer],
        [-price, price - royalty, royalty],
      );
    });

    it("deletes the listing after a sale, so it cannot be bought twice", async function () {
      const { marketplace, fan2, attacker } = f;
      await marketplace.connect(fan2).buy(ticketAddr, 1n, { value: CAP });
      expect((await marketplace.getListing(ticketAddr, 1n)).seller).to.equal(ethers.ZeroAddress);
      await expect(marketplace.connect(attacker).buy(ticketAddr, 1n, { value: CAP }))
        .to.be.revertedWithCustomError(marketplace, "NotListed");
    });

    it("the new owner can resell, and the old owner cannot", async function () {
      const { marketplace, fan1, fan2, attacker } = f;
      await marketplace.connect(fan2).buy(ticketAddr, 1n, { value: CAP });
      await expect(marketplace.connect(fan1).list(ticketAddr, 1n, CAP, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(marketplace, "NotTicketOwner");
      await marketplace.connect(fan2).list(ticketAddr, 1n, CAP, ethers.ZeroAddress);
      await marketplace.connect(attacker).buy(ticketAddr, 1n, { value: CAP });
      expect(await f.ticket.ownerOf(1n)).to.equal(attacker.address);
    });

    it("rejects the wrong payment", async function () {
      const { marketplace, fan2 } = f;
      await expect(marketplace.connect(fan2).buy(ticketAddr, 1n, { value: CAP - 1n }))
        .to.be.revertedWithCustomError(marketplace, "WrongPayment")
        .withArgs(CAP - 1n, CAP);
    });

    it("rejects a cancelled listing", async function () {
      const { marketplace, fan1, fan2 } = f;
      await marketplace.connect(fan1).cancel(ticketAddr, 1n);
      await expect(marketplace.connect(fan2).buy(ticketAddr, 1n, { value: CAP }))
        .to.be.revertedWithCustomError(marketplace, "NotListed");
    });

    it("seller cannot buy their own listing", async function () {
      const { marketplace, fan1 } = f;
      await expect(marketplace.connect(fan1).buy(ticketAddr, 1n, { value: CAP }))
        .to.be.revertedWithCustomError(marketplace, "CannotBuyOwnListing");
    });

    it("rejects a listing made before eventTime once eventTime has passed", async function () {
      const { marketplace, fan2, eventTime } = f;
      await networkHelpers.time.increaseTo(eventTime);
      await expect(marketplace.connect(fan2).buy(ticketAddr, 1n, { value: CAP }))
        .to.be.revertedWithCustomError(marketplace, "TradingClosed");
    });
  });

  describe("private listing", function () {
    beforeEach(async function () {
      await f.marketplace.connect(f.fan1).list(ticketAddr, 1n, CAP, f.fan2.address);
    });

    it("rejects anyone but the allowed buyer", async function () {
      const { marketplace, attacker } = f;
      await expect(marketplace.connect(attacker).buy(ticketAddr, 1n, { value: CAP }))
        .to.be.revertedWithCustomError(marketplace, "NotAllowedBuyer");
    });

    it("accepts the allowed buyer", async function () {
      const { marketplace, ticket, fan2 } = f;
      await marketplace.connect(fan2).buy(ticketAddr, 1n, { value: CAP });
      expect(await ticket.ownerOf(1n)).to.equal(fan2.address);
    });
  });

  describe("attacks", function () {
    async function maliciousSellerFixture() {
      const base = await deployFixture();
      const seller = await ethers.deployContract("MaliciousSeller", [
        await base.ticket.getAddress(),
        await base.marketplace.getAddress(),
      ]);
      // The malicious contract buys ticket #1 and lists it; fan1 buys #2 and lists it.
      await seller.buyAndList(CAP, { value: FACE_VALUE });
      await base.ticket.connect(base.fan1).buy(1, { value: FACE_VALUE });
      await base.marketplace.connect(base.fan1).list(await base.ticket.getAddress(), 2n, CAP, ethers.ZeroAddress);
      return { ...base, seller };
    }

    it("a seller contract cannot re-enter buy while being paid", async function () {
      const { marketplace, ticket, seller, fan1, fan2 } = await networkHelpers.loadFixture(maliciousSellerFixture);
      await seller.setMode(1, 2n); // Reenter: try to buy ticket #2 with the payment

      await marketplace.connect(fan2).buy(await ticket.getAddress(), 1n, { value: CAP });
      expect(await seller.reentryBlocked()).to.equal(true);
      expect(await ticket.ownerOf(1n)).to.equal(fan2.address); // the outer sale completed
      expect(await ticket.ownerOf(2n)).to.equal(fan1.address); // the reentrant buy did not
    });

    it("if the seller refuses payment, the whole sale reverts (atomic swap)", async function () {
      const { marketplace, ticket, seller, fan2 } = await networkHelpers.loadFixture(maliciousSellerFixture);
      await seller.setMode(2, 0n); // Reject

      const tx = marketplace.connect(fan2).buy(await ticket.getAddress(), 1n, { value: CAP });
      await expect(tx).to.be.revertedWithCustomError(marketplace, "TransferFailed");
      // Nothing moved: the seller still has the ticket and the listing is still there.
      expect(await ticket.ownerOf(1n)).to.equal(await seller.getAddress());
      expect((await marketplace.getListing(await ticket.getAddress(), 1n)).price).to.equal(CAP);
    });
  });
});
