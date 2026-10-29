import { useEffect, useState } from "react";
import { isAddress, parseEther, type EventLog } from "ethers";
import { useApp } from "../AppContext";
import { chainNow, eth, getContracts, pct, phaseOf, sameAddr, when } from "../web3";
import { Avatar, Badge, Empty, Modal, Person, Progress, Stat } from "../components/ui";

export function OrganizerView() {
  const { d, read, signer, me, eventAddr, info, now, version, people, who, run } = useApp();
  const [royalties, setRoyalties] = useState(0n);
  const [resales, setResales] = useState(0);
  const [checkedIn, setCheckedIn] = useState(0);
  const [withdrawn, setWithdrawn] = useState(0n);
  const [gates, setGates] = useState<string[]>([]);
  const [newGate, setNewGate] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    const { ticket, marketplace } = getContracts(d, read);
    const t = ticket(eventAddr);
    (async () => {
      const sold = (await marketplace.queryFilter(marketplace.filters.Sold(eventAddr), 0)) as EventLog[];
      setRoyalties(sold.reduce((sum, l) => sum + (l.args.royalty as bigint), 0n));
      setResales(sold.length);
      setCheckedIn(((await t.queryFilter(t.filters.CheckedIn(), 0)) as EventLog[]).length);
      const w = (await t.queryFilter(t.filters.ProceedsWithdrawn(), 0)) as EventLog[];
      setWithdrawn(w.reduce((sum, l) => sum + (l.args.amount as bigint), 0n));
      // Current gates = the latest GateSet per address.
      const state = new Map<string, boolean>();
      for (const l of (await t.queryFilter(t.filters.GateSet(), 0)) as EventLog[]) state.set(l.args.gate, l.args.allowed);
      setGates([...state].filter(([, on]) => on).map(([a]) => a));
    })().catch(() => {});
  }, [d, read, eventAddr, version]);

  if (!info) return null;
  const t = getContracts(d, signer).ticket(eventAddr);
  const isOrganizer = sameAddr(info.organizer, me);
  const phase = phaseOf(info, now);
  const locked = now < info.eventTime;
  const sold = Number(info.totalMinted);
  const gateCandidates = people.filter((p) => !gates.some((g) => sameAddr(g, p.address)) && !sameAddr(p.address, info.organizer));

  return (
    <div className="stack">
      <div className="row-between">
        {isOrganizer ? (
          <span className="muted">You organize this event.</span>
        ) : (
          <div className="callout warn grow">
            This event is organized by {who(info.organizer).name}. You can look, but the contract will reject your changes.
          </div>
        )}
        <button className="secondary" onClick={() => setCreating(true)}>
          + New event
        </button>
      </div>

      <div className="stats">
        <Stat label="Tickets sold" value={`${sold} / ${info.maxSupply}`}>
          <Progress value={sold} max={Number(info.maxSupply)} tone="good" />
        </Stat>
        <Stat
          label="Ticket money in escrow"
          value={eth(info.proceeds)}
          sub={info.cancelled ? "Paid back to fans as refunds" : locked ? `Locked until ${when(info.eventTime)}` : "Unlocked"}
        />
        <Stat label="Resale royalties earned" value={eth(royalties)} sub={`${resales} resale${resales === 1 ? "" : "s"} · paid instantly`} />
        <Stat label="Checked in" value={`${checkedIn} / ${sold}`}>
          <Progress value={checkedIn} max={Math.max(sold, 1)} tone="info" />
        </Stat>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Payout</h2>
          <p className="muted">
            Primary sale money stays locked in the contract until the event starts, so fans can always be refunded if you
            cancel. Royalties from resales are paid to you straight away.
          </p>
          {withdrawn > 0n && <p className="small muted">Already withdrawn: {eth(withdrawn)}</p>}
          <button
            className="primary"
            disabled={locked || info.cancelled || info.proceeds === 0n}
            onClick={() => run({ pending: "Withdrawing…", success: `Withdrew ${eth(info.proceeds)}` }, () => t.withdrawProceeds())}
          >
            {locked ? `Unlocks ${when(info.eventTime)}` : `Withdraw ${eth(info.proceeds)}`}
          </button>
        </section>

        <section className="card">
          <h2>Gate staff</h2>
          <p className="muted">Only these accounts can check tickets in at the door.</p>
          {gates.length === 0 && <Empty title="No gate staff yet" />}
          <ul className="gate-list">
            {gates.map((g) => (
              <li key={g}>
                <Person {...who(g)} />
                <button className="ghost small-btn" onClick={() => run({ pending: "Removing gate…", success: `${who(g).name} removed` }, () => t.setGate(g, false))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="chips">
            {gateCandidates.map((p) => (
              <button key={p.address} className={`chip ${sameAddr(newGate, p.address) ? "active" : ""}`} onClick={() => setNewGate(p.address)}>
                <Avatar name={p.name} color={p.color} size={20} /> {p.name}
              </button>
            ))}
          </div>
          <div className="inline-form">
            <input value={newGate} onChange={(e) => setNewGate(e.target.value)} placeholder="Wallet address 0x…" />
            <button
              className="secondary"
              disabled={!isAddress(newGate)}
              onClick={async () => {
                const r = await run({ pending: "Appointing gate…", success: `${who(newGate).name} can now check tickets in` }, () => t.setGate(newGate, true));
                if (r.ok) setNewGate("");
              }}
            >
              Appoint
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Event rules</h2>
          <p className="muted">Fixed in the contract when the event was created. Nobody can change them, including you.</p>
          <dl className="rules">
            <dt>Face value</dt>
            <dd>{eth(info.faceValue)}</dd>
            <dt>Resale cap</dt>
            <dd>
              {pct(info.resaleCapBps)} of face ({eth(info.maxResalePrice)})
            </dd>
            <dt>Royalty</dt>
            <dd>{pct(info.royaltyBps)} of each resale</dd>
            <dt>Limit</dt>
            <dd>{info.maxPerWallet.toString()} per person</dd>
            <dt>Starts</dt>
            <dd>{when(info.eventTime)}</dd>
            <dt>Check-in until</dt>
            <dd>{when(info.eventTime + info.checkinWindow)}</dd>
          </dl>
        </section>

        <section className="card danger-zone">
          <h2>Cancel event</h2>
          <p className="muted">
            Stops all sales and check-ins. Every ticket holder can then claim the {eth(info.faceValue)} face value back from the
            escrow. Only possible before the event starts.
          </p>
          {info.cancelled ? (
            <Badge tone="bad">Cancelled</Badge>
          ) : (
            <button className="danger" disabled={phase !== "onsale"} onClick={() => setConfirmCancel(true)}>
              Cancel event…
            </button>
          )}
        </section>
      </div>

      {confirmCancel && (
        <Modal title="Cancel this event?" onClose={() => setConfirmCancel(false)}>
          <p>
            This can't be undone. All {sold} ticket holders will be able to claim {eth(info.faceValue)} each, paid from the{" "}
            {eth(info.proceeds)} in escrow.
          </p>
          <div className="modal-actions">
            <button className="ghost" onClick={() => setConfirmCancel(false)}>
              Keep event
            </button>
            <button
              className="danger"
              onClick={async () => {
                await run({ pending: "Cancelling event…", success: "Event cancelled. Fans can now claim refunds." }, () => t.cancelEvent());
                setConfirmCancel(false);
              }}
            >
              Yes, cancel and refund
            </button>
          </div>
        </Modal>
      )}
      {creating && <CreateEvent onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateEvent({ onClose }: { onClose: () => void }) {
  const { d, read, signer, setEventAddr, run } = useApp();
  const [form, setForm] = useState({
    name: "Summer Festival 2027",
    symbol: "SUMMER",
    faceValue: "0.05",
    maxSupply: "200",
    maxPerWallet: "4",
    capPct: "110",
    royaltyPct: "5",
    daysAhead: "14",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    const eventTime = (await chainNow(read)) + Math.round(Number(form.daysAhead) * 86400);
    let created = "";
    const res = await run({ pending: "Creating event…", success: `${form.name} created` }, async () => {
      const tx = await getContracts(d, signer).factory.createEvent({
        name: form.name,
        symbol: form.symbol,
        faceValue: parseEther(form.faceValue || "0"),
        maxSupply: Number(form.maxSupply),
        maxPerWallet: Number(form.maxPerWallet),
        resaleCapBps: Math.round(Number(form.capPct) * 100),
        royaltyBps: Math.round(Number(form.royaltyPct) * 100),
        eventTime,
      });
      const receipt = await tx.wait();
      const log = receipt.logs.find((l: EventLog) => l.fragment?.name === "EventCreated") as EventLog | undefined;
      created = log?.args.ticket ?? "";
    });
    if (res.ok && created) {
      setEventAddr(created);
      onClose();
    }
  }

  return (
    <Modal title="Create an event" onClose={onClose} wide>
      <p className="muted">You become the organizer. These rules are locked in once created.</p>
      <div className="form-grid">
        <label>
          Event name
          <input value={form.name} onChange={set("name")} />
        </label>
        <label>
          Short code
          <input value={form.symbol} onChange={set("symbol")} />
        </label>
        <label>
          Ticket price (ETH)
          <input value={form.faceValue} onChange={set("faceValue")} inputMode="decimal" />
        </label>
        <label>
          Tickets available
          <input value={form.maxSupply} onChange={set("maxSupply")} inputMode="numeric" />
        </label>
        <label>
          Max per person
          <input value={form.maxPerWallet} onChange={set("maxPerWallet")} inputMode="numeric" />
        </label>
        <label>
          Starts in (days)
          <input value={form.daysAhead} onChange={set("daysAhead")} inputMode="decimal" />
        </label>
        <label>
          Resale cap (% of price)
          <input value={form.capPct} onChange={set("capPct")} inputMode="decimal" />
          <span className="small muted">Platform allows 100–200%</span>
        </label>
        <label>
          Your royalty on resales (%)
          <input value={form.royaltyPct} onChange={set("royaltyPct")} inputMode="decimal" />
          <span className="small muted">Platform allows up to 10%</span>
        </label>
      </div>
      <p className="small muted">Tip: after creating it, appoint gate staff so tickets can be checked in.</p>
      <div className="modal-actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" onClick={submit}>
          Create event
        </button>
      </div>
    </Modal>
  );
}
