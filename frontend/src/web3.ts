// Chain access shared by every view: deployment info, contracts, error decoding and chain time.
import {
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  formatEther,
  type ContractRunner,
  type Eip1193Provider,
  type InterfaceAbi,
} from "ethers";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export type DemoAccount = { label: string; index: number; address: string };

/// Written by scripts/demo-setup.ts.
export type Deployments = {
  chainId: number;
  rpcUrl: string;
  factory: string;
  marketplace: string;
  demoEvent: string;
  accounts: DemoAccount[];
  abis: { EventFactory: InterfaceAbi; Marketplace: InterfaceAbi; Ticket: InterfaceAbi };
};

export async function loadDeployments(): Promise<Deployments | null> {
  try {
    const res = await fetch("/deployments.json", { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function getContracts(d: Deployments, runner: ContractRunner) {
  return {
    factory: new Contract(d.factory, d.abis.EventFactory, runner),
    marketplace: new Contract(d.marketplace, d.abis.Marketplace, runner),
    ticket: (address: string) => new Contract(address, d.abis.Ticket, runner),
  };
}

/// Connect MetaMask and make sure it is on the local chain.
export async function connectMetaMask(d: Deployments) {
  if (!window.ethereum) throw new Error("MetaMask not found");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const chainHex = "0x" + d.chainId.toString(16);
  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: chainHex }]);
  } catch {
    await provider.send("wallet_addEthereumChain", [
      {
        chainId: chainHex,
        chainName: "Hardhat Local",
        rpcUrls: [d.rpcUrl],
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      },
    ]);
  }
  return provider.getSigner();
}

/// Timestamp the next block will have. Uses the pending block so it follows the node's clock,
/// including any time travel, rather than the computer's clock.
export async function chainNow(provider: JsonRpcProvider): Promise<number> {
  for (const tag of ["pending", "latest"]) {
    try {
      const block = await provider.send("eth_getBlockByNumber", [tag, false]);
      if (block?.timestamp) return Number(block.timestamp);
    } catch {
      // try the next tag
    }
  }
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------- errors

type Revert = { name: string; args: unknown[] };

/// Find the custom error in a revert. Tries every ABI because Marketplace calls can revert
/// with a Ticket error.
function parseRevert(e: unknown, d: Deployments | null): Revert | null {
  const data = findRevertData(e);
  if (!data || !d) return null;
  for (const abi of [d.abis.Ticket, d.abis.Marketplace, d.abis.EventFactory]) {
    try {
      const parsed = new Interface(abi).parseError(data);
      if (parsed) return { name: parsed.name, args: [...parsed.args] };
    } catch {
      // not this contract's error
    }
  }
  return null;
}

function findRevertData(e: unknown, depth = 0): string | null {
  if (!e || typeof e !== "object" || depth > 6) return null;
  const o = e as Record<string, unknown>;
  if (typeof o.data === "string" && /^0x[0-9a-fA-F]{8}/.test(o.data)) return o.data;
  for (const key of ["error", "info", "data", "cause"]) {
    const found = findRevertData(o[key], depth + 1);
    if (found) return found;
  }
  return null;
}

// Large numbers are almost always wei amounts; small ones are ticket ids or counts.
const ethArg = (a: unknown) => (typeof a === "bigint" && a > 10n ** 12n ? eth(a) : String(a));

/// Plain-English explanation for each custom error in our contracts.
const MESSAGES: Record<string, (args: unknown[]) => string> = {
  TradingClosed: () => "Trading is closed: the event has started or was cancelled.",
  PriceAboveCap: ([, cap]) => `That's above the organizer's resale cap. The most this ticket can sell for is ${ethArg(cap)}.`,
  ZeroPrice: () => "Enter a price above 0.",
  NotAllowedBuyer: () => "This listing is reserved for a different buyer.",
  CannotBuyOwnListing: () => "You can't buy your own listing.",
  NotTicketOwner: () => "This wallet doesn't own that ticket.",
  TicketUsed: () => "That ticket has already been used at the door.",
  WrongPayment: ([sent, expected]) => `Wrong payment: sent ${ethArg(sent)}, the price is ${ethArg(expected)}.`,
  NotListed: () => "That ticket isn't for sale any more (it may have just sold or been taken down).",
  NotSeller: () => "Only the seller can take this listing down.",
  UnregisteredTicket: () => "That isn't a genuine event on this platform.",
  TransferFailed: () => "A payment couldn't be delivered, so the whole transaction was undone.",
  SoldOut: ([left]) => (left === 0n ? "Sold out." : `Only ${left} ticket(s) left.`),
  WalletLimitExceeded: ([left]) =>
    left === 0n ? "You've reached the per-wallet limit for this event." : `You can only buy ${left} more.`,
  InvalidQuantity: () => "Choose at least one ticket.",
  NotOrganizer: () => "Only this event's organizer can do that.",
  NotGate: () => "This account isn't appointed gate staff for this event.",
  NotMarketplace: () => "Tickets can only move through the marketplace.",
  TransfersDisabled: () => "Tickets can't be sent directly; they can only be resold through the marketplace.",
  CheckInClosed: () => "The check-in window for this event has closed.",
  SignatureExpired: () => "This QR code has expired. Ask the fan to show a fresh one.",
  NotHolder: () => "The QR was signed by someone who doesn't own this ticket.",
  AlreadyCheckedIn: () => "This ticket has already been scanned in.",
  ProceedsLocked: ([t]) => `Ticket money stays in escrow until the event starts (${when(Number(t))}).`,
  NoProceeds: () => "There's nothing to withdraw.",
  EventIsCancelled: () => "This event has been cancelled.",
  EventNotCancelled: () => "Refunds are only available if the organizer cancels the event.",
  EventAlreadyStarted: () => "The event has already started, so it can't be cancelled.",
  InvalidParams: () => "Price, supply and per-wallet limit must all be above 0.",
  CapOutOfBounds: () => "The resale cap must be between 100% and 200% of face value.",
  RoyaltyTooHigh: () => "The royalty can be at most 10%.",
  EventTimeInPast: () => "The event must start in the future.",
  ERC721NonexistentToken: () => "That ticket doesn't exist (or was refunded).",
  ReentrancyGuardReentrantCall: () => "Blocked a re-entrant call.",
};

export type FriendlyError = { message: string; code?: string };

export function friendlyError(e: unknown, d: Deployments | null): FriendlyError {
  const r = parseRevert(e, d);
  if (r) {
    const code = `${r.name}(${r.args.map(ethArg).join(", ")})`;
    return { message: MESSAGES[r.name]?.(r.args) ?? "The contract rejected this transaction.", code };
  }
  const err = e as { code?: string; reason?: string; shortMessage?: string; message?: string };
  if (err?.code === "ACTION_REJECTED") return { message: "You rejected the request in your wallet." };
  if (err?.code === "INSUFFICIENT_FUNDS") return { message: "Not enough ETH in this wallet." };
  return { message: err?.reason ?? err?.shortMessage ?? err?.message ?? String(e) };
}

// ---------------------------------------------------------------- event data

export type EventInfo = {
  address: string;
  name: string;
  organizer: string;
  faceValue: bigint;
  maxSupply: bigint;
  totalMinted: bigint;
  maxPerWallet: bigint;
  resaleCapBps: bigint;
  royaltyBps: bigint;
  eventTime: number;
  checkinWindow: number;
  cancelled: boolean;
  tradingOpen: boolean;
  proceeds: bigint;
  maxResalePrice: bigint;
};

export async function loadEvent(ticket: Contract): Promise<EventInfo> {
  const [
    name,
    organizer,
    faceValue,
    maxSupply,
    totalMinted,
    maxPerWallet,
    resaleCapBps,
    royaltyBps,
    eventTime,
    checkinWindow,
    cancelled,
    tradingOpen,
    proceeds,
    maxResalePrice,
  ] = await Promise.all([
    ticket.name(),
    ticket.organizer(),
    ticket.faceValue(),
    ticket.maxSupply(),
    ticket.totalMinted(),
    ticket.maxPerWallet(),
    ticket.resaleCapBps(),
    ticket.royaltyBps(),
    ticket.eventTime(),
    ticket.CHECKIN_WINDOW(),
    ticket.cancelled(),
    ticket.tradingOpen(),
    ticket.proceeds(),
    ticket.maxResalePrice(),
  ]);
  return {
    address: await ticket.getAddress(),
    name,
    organizer,
    faceValue,
    maxSupply,
    totalMinted,
    maxPerWallet,
    resaleCapBps,
    royaltyBps,
    eventTime: Number(eventTime),
    checkinWindow: Number(checkinWindow),
    cancelled,
    tradingOpen,
    proceeds,
    maxResalePrice,
  };
}

export type Phase = "onsale" | "doors" | "over" | "cancelled";

/// Where the event is in its life: on sale, check-in window, expired, or cancelled.
export function phaseOf(info: EventInfo, now: number): Phase {
  if (info.cancelled) return "cancelled";
  if (now < info.eventTime) return "onsale";
  if (now < info.eventTime + info.checkinWindow) return "doors";
  return "over";
}

// ---------------------------------------------------------------- formatting

/// "0.11 ETH", trimmed to 4 decimals.
export function eth(wei: bigint) {
  const s = formatEther(wei);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, 4).replace(/0+$/, "");
  return `${i}${frac ? "." + frac : ""} ETH`;
}

export const pct = (bps: bigint) => `${Number(bps) / 100}%`;

export const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/// "6d 23h", "3h 12m", "45s".
export function countdown(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export const sameAddr = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
