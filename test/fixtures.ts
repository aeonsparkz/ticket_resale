import { network } from "hardhat";

// One network connection shared by every test file, so loadFixture snapshots work across files.
export const { ethers, networkHelpers } = await network.create();

export const FACE_VALUE = ethers.parseEther("0.1");
export const MAX_SUPPLY = 5;
export const MAX_PER_WALLET = 2;
export const RESALE_CAP_BPS = 11_000; // 110% of face value
export const ROYALTY_BPS = 500; // 5%
export const ONE_WEEK = 7 * 24 * 60 * 60;
export const CHECKIN_WINDOW = 12 * 60 * 60;

/// Default event parameters; override fields per test, e.g. eventParams(eventTime, { maxSupply: 1 }).
export function eventParams(eventTime: number, overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Concert",
    symbol: "TIX",
    faceValue: FACE_VALUE,
    maxSupply: MAX_SUPPLY,
    maxPerWallet: MAX_PER_WALLET,
    resaleCapBps: RESALE_CAP_BPS,
    royaltyBps: ROYALTY_BPS,
    eventTime,
    ...overrides,
  };
}

/// Deploys the factory (which deploys the marketplace) and creates one event a week from now.
export async function deployFixture() {
  const [deployer, organizer, gate, fan1, fan2, attacker] = await ethers.getSigners();

  const factory = await ethers.deployContract("EventFactory");
  const marketplace = await ethers.getContractAt("Marketplace", await factory.marketplace());

  const eventTime = (await networkHelpers.time.latest()) + ONE_WEEK;
  await factory.connect(organizer).createEvent(eventParams(eventTime));
  const [ticketAddr] = await factory.getEventsByOrganizer(organizer.address);
  const ticket = await ethers.getContractAt("Ticket", ticketAddr);

  return { factory, marketplace, ticket, eventTime, deployer, organizer, gate, fan1, fan2, attacker };
}
