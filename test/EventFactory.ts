import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("EventFactory", function () {
  async function deploy() {
    const [deployer, organizer, fan1] = await ethers.getSigners();
    const factory = await ethers.deployContract("EventFactory");
    return { factory, deployer, organizer, fan1 };
  }

  it("deploys a Marketplace on construction", async function () {
    const { factory } = await deploy();
    expect(await factory.marketplace()).to.not.equal(ethers.ZeroAddress);
  });

  it("creates an event and registers its Ticket contract", async function () {
    const { factory, organizer } = await deploy();
    const faceValue = ethers.parseEther("0.1");

    await expect(
      factory.connect(organizer).createEvent("Test Concert", "TIX", faceValue, 100, 4, 11_000, 500),
    ).to.emit(factory, "EventCreated");

    const [ticketAddr] = await factory.getEventsByOrganizer(organizer.address);
    expect(await factory.isTicket(ticketAddr)).to.equal(true);

    const ticket = await ethers.getContractAt("Ticket", ticketAddr);
    expect(await ticket.organizer()).to.equal(organizer.address);
    expect(await ticket.maxResalePrice()).to.equal(ethers.parseEther("0.11"));
  });

  it("rejects a resale cap outside platform bounds", async function () {
    const { factory, organizer } = await deploy();
    await expect(
      factory.connect(organizer).createEvent("X", "X", 1n, 100, 4, 25_000, 500),
    ).to.be.revertedWithCustomError(factory, "CapOutOfBounds");
  });

  it("rejects a royalty above the platform max", async function () {
    const { factory, organizer } = await deploy();
    await expect(
      factory.connect(organizer).createEvent("X", "X", 1n, 100, 4, 11_000, 2_000),
    ).to.be.revertedWithCustomError(factory, "RoyaltyTooHigh");
  });
});
