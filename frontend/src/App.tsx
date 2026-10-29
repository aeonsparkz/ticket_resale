import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JsonRpcProvider, type Signer } from "ethers";
import { AppContext, type AppCtx } from "./AppContext";
import { castOf, type Role } from "./people";
import {
  chainNow,
  connectMetaMask,
  eth,
  friendlyError,
  getContracts,
  loadDeployments,
  loadEvent,
  sameAddr,
  short,
  type Deployments,
  type EventInfo,
} from "./web3";
import { Avatar, Toasts, type Toast } from "./components/ui";
import { EventHero } from "./components/EventHero";
import { Activity } from "./components/Activity";
import { DemoBar } from "./components/DemoBar";
import { FanView } from "./views/FanView";
import { OrganizerView } from "./views/OrganizerView";
import { GateView } from "./views/GateView";

const POLL_MS = 3000;

export default function App() {
  const [d, setD] = useState<Deployments | null | undefined>(undefined);
  useEffect(() => {
    loadDeployments().then(setD);
  }, []);

  if (d === undefined) return <div className="splash">Loading…</div>;
  if (d === null) return <SetupHelp />;
  return <Connected d={d} />;
}

/// The URL hash remembers who you are, e.g. #as=Bob, so two windows can play two people.
function personFromHash(d: Deployments) {
  const as = new URLSearchParams(window.location.hash.slice(1)).get("as")?.toLowerCase();
  const cast = castOf(d.accounts);
  return (cast.find((p) => p.name.toLowerCase() === as || p.label.toLowerCase() === as) ?? cast[2] ?? cast[0]).index;
}

function Connected({ d }: { d: Deployments }) {
  // cacheTimeout -1: ethers otherwise reuses identical reads for 250ms, so a view reloaded
  // straight after a transaction could show the old state.
  const read = useMemo(() => new JsonRpcProvider(d.rpcUrl, undefined, { cacheTimeout: -1 }), [d]);
  const people = useMemo(() => castOf(d.accounts), [d]);

  const [mode, setMode] = useState<"local" | "metamask">("local");
  const [accountIndex, setAccountIndex] = useState(() => personFromHash(d));
  const [metaRole, setMetaRole] = useState<Role>("fan");
  const [signer, setSigner] = useState<Signer | null>(null);
  const [me, setMe] = useState("");
  const [version, setVersion] = useState(0);
  const [eventAddr, setEventAddr] = useState(d.demoEvent);
  const [events, setEvents] = useState<{ address: string; name: string }[]>([]);
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [now, setNow] = useState(0);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Local mode: sign as one of the node's unlocked demo accounts (no wallet popups).
  useEffect(() => {
    if (mode !== "local") return;
    read.getSigner(accountIndex).then(async (s) => {
      setSigner(s);
      setMe(await s.getAddress());
    });
    const p = people.find((x) => x.index === accountIndex);
    if (p) window.history.replaceState(null, "", `#as=${encodeURIComponent(p.name)}`);
  }, [mode, accountIndex, read, people]);

  // Poll so that actions taken in another window show up here too.
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const tick = () => chainNow(read).then(setNow);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [read, version]);

  useEffect(() => {
    const { factory, ticket } = getContracts(d, read);
    (async () => {
      const addrs: string[] = await factory.getAllEvents();
      setEvents(await Promise.all(addrs.map(async (a) => ({ address: a, name: await ticket(a).name() }))));
      setInfo(await loadEvent(ticket(eventAddr)));
      const entries = await Promise.all(people.map(async (p) => [p.address, await read.getBalance(p.address)] as const));
      setBalances(Object.fromEntries(entries));
    })().catch(() => {});
  }, [d, read, eventAddr, version, people]);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    return id;
  }, []);
  const updateToast = useCallback((id: number, t: Omit<Toast, "id">) => {
    setToasts((ts) => ts.map((x) => (x.id === id ? { ...t, id } : x)));
    if (t.kind === "ok") setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const run = useCallback<AppCtx["run"]>(
    async (msgs, send) => {
      const id = pushToast({ kind: "pending", title: msgs.pending });
      try {
        const tx = await send();
        if (tx) await tx.wait();
        updateToast(id, { kind: "ok", title: msgs.success });
        return { ok: true };
      } catch (e) {
        const error = friendlyError(e, d);
        updateToast(id, { kind: "error", title: error.message, code: error.code });
        return { ok: false, error };
      } finally {
        refresh();
      }
    },
    [d, pushToast, updateToast, refresh],
  );

  const who = useCallback(
    (addr: string) => {
      const p = people.find((x) => sameAddr(x.address, addr));
      return p ? { name: p.name, color: p.color } : { name: short(addr), color: "#64748b" };
    },
    [people],
  );

  async function connectWallet() {
    try {
      const s = await connectMetaMask(d);
      setMode("metamask");
      setSigner(s);
      setMe(await s.getAddress());
    } catch (e) {
      pushToast({ kind: "error", title: friendlyError(e, d).message });
    }
  }

  if (!signer) return <div className="splash">Connecting to the local chain at {d.rpcUrl}…</div>;

  const person = mode === "local" ? people.find((p) => p.index === accountIndex) : undefined;
  const role: Role = person?.role ?? metaRole;
  const ctx: AppCtx = { d, read, signer, me, mode, people, who, eventAddr, setEventAddr, info, now, version, refresh, run };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">◆</span>
            <div>
              <div className="brand-name">Scam-Proof Tickets</div>
              <div className="brand-sub">IS4302 · on-chain ticket resale</div>
            </div>
          </div>
          <label className="event-picker">
            <span className="muted">Event</span>
            <select value={eventAddr} onChange={(e) => setEventAddr(e.target.value)}>
              {events.map((ev) => (
                <option key={ev.address} value={ev.address}>
                  {ev.name}
                </option>
              ))}
            </select>
          </label>
        </header>

        <section className="cast">
          <div className="cast-title">
            <span>Who are you?</span>
            {mode === "local" ? (
              <button className="link" onClick={connectWallet}>
                Use MetaMask instead
              </button>
            ) : (
              <button className="link" onClick={() => setMode("local")}>
                Back to demo people
              </button>
            )}
          </div>
          {mode === "local" ? (
            <div className="cast-list">
              {people.map((p) => (
                <button
                  key={p.index}
                  className={`cast-card ${p.index === accountIndex ? "active" : ""}`}
                  style={{ "--person": p.color } as React.CSSProperties}
                  onClick={() => setAccountIndex(p.index)}
                >
                  <Avatar name={p.name} color={p.color} size={36} />
                  <span className="cast-text">
                    <span className="cast-name">{p.name}</span>
                    <span className="cast-blurb">{p.blurb}</span>
                    <span className="cast-balance">{balances[p.address] !== undefined ? eth(balances[p.address]) : "\u00a0"}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="cast-list">
              <div className="cast-card active">
                <Avatar name="M" color="#f97316" size={36} />
                <span className="cast-text">
                  <span className="cast-name">MetaMask</span>
                  <span className="cast-blurb">{short(me)}</span>
                </span>
              </div>
              <div className="segmented">
                {(["fan", "organizer", "gate"] as Role[]).map((r) => (
                  <button key={r} className={metaRole === r ? "active" : ""} onClick={() => setMetaRole(r)}>
                    {r === "fan" ? "Fan" : r === "organizer" ? "Organizer" : "Gate"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {person?.hint && (
            <div className="hint" style={{ borderColor: person.color }}>
              <strong>You're {person.name}.</strong> {person.hint}
            </div>
          )}
        </section>

        <div className="layout">
          <main className="main">
            {info ? (
              <>
                <EventHero />
                {role === "fan" && <FanView />}
                {role === "organizer" && <OrganizerView />}
                {role === "gate" && <GateView />}
              </>
            ) : (
              <div className="card">Loading event…</div>
            )}
          </main>
          <aside className="side">
            <Activity />
          </aside>
        </div>

        <DemoBar />
        <Toasts toasts={toasts} dismiss={dismiss} />
      </div>
    </AppContext.Provider>
  );
}

function SetupHelp() {
  return (
    <div className="splash">
      <div className="card" style={{ maxWidth: 640 }}>
        <h2>No deployment found</h2>
        <p>From the project root, start a local chain and deploy the demo:</p>
        <pre>
          {`npx hardhat node                                            # terminal 1
npx hardhat run scripts/demo-setup.ts --network localhost   # terminal 2`}
        </pre>
        <p>Then reload this page.</p>
      </div>
    </div>
  );
}
