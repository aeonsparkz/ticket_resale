import { network } from "hardhat";
import type { Signer } from "ethers";

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

/// What the fan app does for the rotating QR: sign (ticket contract, chain id, token id, validUntil).
/// signMessage adds the EIP-191 prefix, matching MessageHashUtils.toEthSignedMessageHash on-chain.
export async function signCheckIn(holder: Signer, ticketAddr: string, id: bigint, validUntil: number) {
  const { chainId } = await ethers.provider.getNetwork();
  const hash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "uint256"],
      [ticketAddr, chainId, id, validUntil],
    ),
  );
  return holder.signMessage(ethers.getBytes(hash));
}

/// Deploys the factory (which deploys the marketplace), creates one event a week from now,
/// and appoints `gate` as a check-in scanner.
export async function deployFixture() {
  const [deployer, organizer, gate, fan1, fan2, attacker] = await ethers.getSigners();

  const factory = await ethers.deployContract("EventFactory");
  const marketplace = await ethers.getContractAt("Marketplace", await factory.marketplace());

  const eventTime = (await networkHelpers.time.latest()) + ONE_WEEK;
  await factory.connect(organizer).createEvent(eventParams(eventTime));
  const [ticketAddr] = await factory.getEventsByOrganizer(organizer.address);
  const ticket = await ethers.getContractAt("Ticket", ticketAddr);
  await ticket.connect(organizer).setGate(gate.address, true);

  return { factory, marketplace, ticket, eventTime, deployer, organizer, gate, fan1, fan2, attacker };
}
