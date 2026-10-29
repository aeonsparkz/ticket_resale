// Deploys the platform to a running local node, creates a demo event, appoints a gate,
// and writes addresses + ABIs to frontend/public/deployments.json for the front end.
//
//   npx hardhat node                                             (terminal 1)
//   npx hardhat run scripts/demo-setup.ts --network localhost    (terminal 2)
import { writeFile } from "node:fs/promises";
import { artifacts, network } from "hardhat";

const LOCAL_CHAIN_ID = 31337n;
const OUT = new URL("../frontend/public/deployments.json", import.meta.url);

const { ethers, networkHelpers } = await network.create();

const { chainId } = await ethers.provider.getNetwork();
if (chainId !== LOCAL_CHAIN_ID) {
  throw new Error(`demo-setup is for the local node only (chain ${LOCAL_CHAIN_ID}), not chain ${chainId}`);
}

const signers = await ethers.getSigners();
const [deployer, organizer, gate, fan1, fan2, stranger] = signers;

// Ethers directly rather than Ignition: Ignition keeps a deployment journal per chain id,
// which goes stale every time the local node restarts.
const factory = await ethers.deployContract("EventFactory", [], deployer);
await factory.waitForDeployment();
const marketplace = await factory.marketplace();

const eventTime = (await networkHelpers.time.latest()) + 7 * 24 * 60 * 60;
const tx = await factory.connect(organizer).createEvent({
  name: "IS4302 Live 2027",
  symbol: "IS4302",
  faceValue: ethers.parseEther("0.1"),
  maxSupply: 100,
  maxPerWallet: 4,
  resaleCapBps: 11_000,
  royaltyBps: 500,
  eventTime,
});
await tx.wait();
const [demoEvent] = await factory.getEventsByOrganizer(organizer.address);

const ticket = await ethers.getContractAt("Ticket", demoEvent);
await (await ticket.connect(organizer).setGate(gate.address, true)).wait();

const accounts = [
  ["Organizer", organizer],
  ["Gate", gate],
  ["Fan 1", fan1],
  ["Fan 2", fan2],
  ["Stranger", stranger],
] as const;

const deployments = {
  chainId: Number(chainId),
  rpcUrl: "http://127.0.0.1:8545",
  factory: await factory.getAddress(),
  marketplace,
  demoEvent,
  // Hardhat node accounts are unlocked, so the front end can sign as them without private keys.
  // `index` is the node account number the front end passes to provider.getSigner(index).
  accounts: accounts.map(([label, signer]) => ({
    label,
    index: signers.findIndex((s) => s.address === signer.address),
    address: signer.address,
  })),
  abis: {
    EventFactory: (await artifacts.readArtifact("EventFactory")).abi,
    Marketplace: (await artifacts.readArtifact("Marketplace")).abi,
    Ticket: (await artifacts.readArtifact("Ticket")).abi,
  },
};

await writeFile(OUT, JSON.stringify(deployments, null, 2));

console.log("EventFactory:", deployments.factory);
console.log("Marketplace: ", marketplace);
console.log("Demo event:  ", demoEvent, `(starts ${new Date(eventTime * 1000).toISOString()})`);
console.log("Gate:        ", gate.address);
console.log("Wrote", OUT.pathname);
