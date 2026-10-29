import { expect } from "chai";
import {
  deployFixture,
  ethers,
  eventParams,
  networkHelpers,
  FACE_VALUE,
  MAX_SUPPLY,
  RESALE_CAP_BPS,
  ROYALTY_BPS,
} from "./fixtures.js";

describe("EventFactory", function () {
  let f: Awaited<ReturnType<typeof deployFixture>>;

  beforeEach(async function () {
    f = await networkHelpers.loadFixture(deployFixture);
  });

  it("deploys a Marketplace that points back to the factory", async function () {
    expect(await f.marketplace.factory()).to.equal(await f.factory.getAddress());
  });

  it("creates an event with the correct parameters", async function () {
    const { ticket, organizer, marketplace, factory, eventTime } = f;
    expect(await ticket.organizer()).to.equal(organizer.address);
    expect(await ticket.marketplace()).to.equal(await marketplace.getAddress());
    expect(await ticket.factory()).to.equal(await factory.getAddress());
    expect(await ticket.faceValue()).to.equal(FACE_VALUE);
    expect(await ticket.maxSupply()).to.equal(BigInt(MAX_SUPPLY));
    expect(await ticket.resaleCapBps()).to.equal(BigInt(RESALE_CAP_BPS));
    expect(await ticket.royaltyBps()).to.equal(BigInt(ROYALTY_BPS));
    expect(await ticket.eventTime()).to.equal(BigInt(eventTime));
    expect(await ticket.maxResalePrice()).to.equal(ethers.parseEther("0.11"));
  });

  it("registers the Ticket contract and emits EventCreated", async function () {
    const { factory, organizer, ticket, eventTime } = f;
    expect(await factory.isTicket(await ticket.getAddress())).to.equal(true);
    expect(await factory.getAllEvents()).to.deep.equal([await ticket.getAddress()]);

    await expect(factory.connect(organizer).createEvent(eventParams(eventTime)))
      .to.emit(factory, "EventCreated");
    expect((await factory.getEventsByOrganizer(organizer.address)).length).to.equal(2);
  });

  it("does not register arbitrary addresses", async function () {
    expect(await f.factory.isTicket(f.attacker.address)).to.equal(false);
  });

  it("rejects zero face value, supply or per-wallet limit", async function () {
    const { factory, organizer, eventTime } = f;
    for (const bad of [{ faceValue: 0n }, { maxSupply: 0 }, { maxPerWallet: 0 }]) {
      await expect(factory.connect(organizer).createEvent(eventParams(eventTime, bad)))
        .to.be.revertedWithCustomError(factory, "InvalidParams");
    }
  });

  it("rejects a resale cap outside platform bounds", async function () {
    const { factory, organizer, eventTime } = f;
    for (const resaleCapBps of [9_999, 20_001]) {
      await expect(factory.connect(organizer).createEvent(eventParams(eventTime, { resaleCapBps })))
        .to.be.revertedWithCustomError(factory, "CapOutOfBounds")
        .withArgs(resaleCapBps);
    }
  });

  it("rejects a royalty above the platform max", async function () {
    const { factory, organizer, eventTime } = f;
    await expect(factory.connect(organizer).createEvent(eventParams(eventTime, { royaltyBps: 1_001 })))
      .to.be.revertedWithCustomError(factory, "RoyaltyTooHigh")
      .withArgs(1_001);
  });

  it("rejects an event time in the past", async function () {
    const { factory, organizer } = f;
    const past = (await networkHelpers.time.latest()) - 1;
    await expect(factory.connect(organizer).createEvent(eventParams(past)))
      .to.be.revertedWithCustomError(factory, "EventTimeInPast");
  });
});
