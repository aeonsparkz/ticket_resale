import { createContext, useContext } from "react";
import type { ContractTransactionResponse, JsonRpcProvider, Signer } from "ethers";
import type { Person } from "./people";
import type { Deployments, EventInfo, FriendlyError } from "./web3";

export type RunResult = { ok: boolean; error?: FriendlyError };

export type AppCtx = {
  d: Deployments;
  /// Read-only connection to the node, independent of the wallet.
  read: JsonRpcProvider;
  signer: Signer;
  me: string;
  mode: "local" | "metamask";
  /// The demo cast with addresses.
  people: Person[];
  /// Display name and colour for any address.
  who: (addr: string) => { name: string; color: string };
  /// Selected event (Ticket contract address) and its data.
  eventAddr: string;
  setEventAddr: (a: string) => void;
  info: EventInfo | null;
  /// Chain time (next block's timestamp), updated every second.
  now: number;
  /// Bumped after every transaction and every few seconds, so views reload.
  version: number;
  refresh: () => void;
  /// Send a transaction with toast feedback; returns whether it succeeded and why not.
  run: (
    msgs: { pending: string; success: string },
    send: () => Promise<ContractTransactionResponse | void>,
  ) => Promise<RunResult>;
};

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppContext");
  return ctx;
}
