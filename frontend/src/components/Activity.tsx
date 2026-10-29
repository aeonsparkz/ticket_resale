// Plain-English feed of this event's on-chain history, read from contract logs. Shows that
// anyone can audit every sale, royalty and check-in.
import { useEffect, useState, type ReactNode } from "react";
import type { EventLog } from "ethers";
import { useApp } from "../AppContext";
import { eth, getContracts } from "../web3";
import { Empty, Person } from "./ui";

type Item = { key: string; block: number; index: number; icon: string; tone: string; text: ReactNode };

export function Activity() {
  const { d, read, eventAddr, version, who } = useApp();
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const { ticket, marketplace } = getContracts(d, read);
    const t = ticket(eventAddr);
    const P = (addr: string) => <Person {...who(addr)} />;

    (async () => {
      const logs = [
        ...((await t.queryFilter("*", 0)) as EventLog[]),
        ...((await marketplace.queryFilter(marketplace.filters.Listed(eventAddr), 0)) as EventLog[]),
        ...((await marketplace.queryFilter(marketplace.filters.Cancelled(eventAddr), 0)) as EventLog[]),
        ...((await marketplace.queryFilter(marketplace.filters.Sold(eventAddr), 0)) as EventLog[]),
      ];
      const out: Item[] = [];
      for (const l of logs) {
        const a = l.args;
        let item: Omit<Item, "key" | "block" | "index"> | null = null;
        switch (l.fragment?.name) {
          case "TicketPurchased": {
            const first = a.firstId as bigint;
            const q = a.quantity as bigint;
            const ids = q === 1n ? `#${first}` : `#${first}–#${first + q - 1n}`;
            item = { icon: "🎟", tone: "good", text: <>{P(a.buyer)} bought {q.toString()} ticket{q === 1n ? "" : "s"} ({ids}) from the organizer</> };
            break;
          }
          case "Listed":
            item = {
              icon: "🏷",
              tone: "info",
              text: (
                <>
                  {P(a.seller)} listed #{a.id.toString()} for {eth(a.price)}
                  {a.allowedBuyer !== "0x0000000000000000000000000000000000000000" && <>, reserved for {P(a.allowedBuyer)}</>}
                </>
              ),
            };
            break;
          case "Cancelled":
            item = { icon: "↩", tone: "neutral", text: <>Listing for #{a.id.toString()} taken down</> };
            break;
          case "Sold":
            item = {
              icon: "🤝",
              tone: "good",
              text: (
                <>
                  {P(a.buyer)} bought #{a.id.toString()} from {P(a.seller)} for {eth(a.price)}
                  <span className="muted"> · organizer royalty {eth(a.royalty)}</span>
                </>
              ),
            };
            break;
          case "CheckedIn":
            item = { icon: "✅", tone: "good", text: <>{P(a.holder)} checked in with #{a.id.toString()}</> };
            break;
          case "GateSet":
            item = { icon: "🛂", tone: "neutral", text: <>{P(a.gate)} {a.allowed ? "appointed as" : "removed from"} gate staff</> };
            break;
          case "EventCancelled":
            item = { icon: "⛔", tone: "bad", text: <>The organizer cancelled the event. Holders can claim refunds.</> };
            break;
          case "Refunded":
            item = { icon: "💸", tone: "info", text: <>{P(a.holder)} got a {eth(a.amount)} refund for #{a.id.toString()}</> };
            break;
          case "ProceedsWithdrawn":
            item = { icon: "💰", tone: "neutral", text: <>{P(a.organizer)} withdrew {eth(a.amount)} of ticket sales</> };
            break;
        }
        if (item) out.push({ ...item, key: `${l.transactionHash}-${l.index}`, block: l.blockNumber, index: l.index });
      }
      out.sort((x, y) => y.block - x.block || y.index - x.index);
      setItems(out.slice(0, 40));
    })().catch(() => {});
  }, [d, read, eventAddr, version, who]);

  return (
    <section className="card activity">
      <div className="card-head">
        <h2>Public activity</h2>
        <span className="muted small">read from the blockchain</span>
      </div>
      {items.length === 0 ? (
        <Empty title="Nothing yet">Ticket sales, resales and check-ins will appear here.</Empty>
      ) : (
        <ul className="feed">
          {items.map((i) => (
            <li key={i.key} className={`feed-item ${i.tone}`}>
              <span className="feed-icon">{i.icon}</span>
              <span className="feed-text">{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
