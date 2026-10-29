// The demo cast. Labels come from scripts/demo-setup.ts; names and stories make the demo readable.
import type { DemoAccount } from "./web3";

export type Role = "organizer" | "gate" | "fan";

export type Person = DemoAccount & {
  name: string;
  role: Role;
  blurb: string;
  /// What this person should try in the demo.
  hint: string;
  color: string;
};

const CAST: Record<string, Omit<Person, keyof DemoAccount>> = {
  Organizer: {
    name: "Organizer",
    role: "organizer",
    blurb: "Runs the event",
    hint: "Watch sales and royalties come in, appoint gate staff, or cancel the event to trigger refunds.",
    color: "#7c3aed",
  },
  Gate: {
    name: "Gate staff",
    role: "gate",
    blurb: "Scans tickets at the door",
    hint: "Scan a fan's QR code. Only a fresh code signed by the ticket's current owner gets in, and only once.",
    color: "#0891b2",
  },
  "Fan 1": {
    name: "Alice",
    role: "fan",
    blurb: "Bought tickets, can't go",
    hint: "Buy tickets, then sell one to Bob. Reserve it for him so nobody else can take it.",
    color: "#db2777",
  },
  "Fan 2": {
    name: "Bob",
    role: "fan",
    blurb: "Met Alice on Telegram",
    hint: "Check Alice's ticket is genuine, then buy it. Payment and ticket swap in one transaction.",
    color: "#2563eb",
  },
  Stranger: {
    name: "Mallory",
    role: "fan",
    blurb: "Scalper trying to cheat",
    hint: "Try to cheat: buy a ticket reserved for Bob, or list a ticket above the price cap.",
    color: "#d97706",
  },
};

export function castOf(accounts: DemoAccount[]): Person[] {
  return accounts.map((a) => ({
    ...a,
    ...(CAST[a.label] ?? { name: a.label, role: "fan", blurb: "", hint: "", color: "#64748b" }),
  }));
}
