import { useEffect, useState } from "react";
import { getBytes, verifyMessage } from "ethers";
import { useApp } from "../AppContext";
import { chainNow, getContracts, phaseOf, sameAddr } from "../web3";
import { Badge, Check, Person, Progress } from "../components/ui";
import { latestQr, onQr } from "../qrShare";

type Payload = { ticket: string; id: string; validUntil: number; sig: string };
type Preview = {
  genuine: boolean;
  signer: string | null;
  owner: string | null;
  secondsLeft: number;
  used: boolean;
};
type Verdict = { admit: boolean; title: string; detail?: string; code?: string };

function parse(text: string): Payload | null {
  try {
    const p = JSON.parse(text);
    return p && p.ticket && p.id && p.validUntil && p.sig ? p : null;
  } catch {
    return null;
  }
}

/// The door scanner. A real venue reads the QR with a camera; here "Scan" picks up the code a
/// fan is showing in this browser, or a code can be pasted.
export function GateView() {
  const { d, read, signer, me, eventAddr, info, now, version, who, run } = useApp();
  const [isGate, setIsGate] = useState<boolean | null>(null);
  const [checkedIn, setCheckedIn] = useState(0);
  const [onScreen, setOnScreen] = useState<string | null>(latestQr());
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  useEffect(() => onQr(setOnScreen), []);

  useEffect(() => {
    const t = getContracts(d, read).ticket(eventAddr);
    t.isGate(me).then(setIsGate);
    t.queryFilter(t.filters.CheckedIn(), 0).then((l) => setCheckedIn(l.length));
  }, [d, read, me, eventAddr, version]);

  // Read what the contract will check, so staff see why a ticket would be refused.
  useEffect(() => {
    if (!payload) return;
    const { factory, ticket } = getContracts(d, read);
    const t = ticket(payload.ticket);
    (async () => {
      const genuine: boolean = await factory.isTicket(payload.ticket);
      if (!genuine) return setPreview({ genuine, signer: null, owner: null, secondsLeft: 0, used: false });
      const hash: string = await t.checkInHash(BigInt(payload.id), payload.validUntil);
      const s = verifyMessage(getBytes(hash), payload.sig);
      const owner = await t.ownerOf(BigInt(payload.id)).catch(() => null);
      const used: boolean = await t.used(BigInt(payload.id));
      setPreview({ genuine, signer: s, owner, used, secondsLeft: payload.validUntil - (await chainNow(read)) });
    })().catch(() => setPreview({ genuine: false, signer: null, owner: null, secondsLeft: 0, used: false }));
  }, [payload, d, read, version]);

  function scan(text: string | null) {
    setVerdict(null);
    setPreview(null);
    setPayload(text ? parse(text) : null);
    if (text && !parse(text)) setVerdict({ admit: false, title: "That isn't a ticket QR code" });
  }

  async function admit() {
    if (!payload) return;
    const res = await run({ pending: `Checking in ticket #${payload.id}…`, success: `Ticket #${payload.id} admitted` }, () =>
      getContracts(d, signer).ticket(payload.ticket).checkIn(BigInt(payload.id), payload.validUntil, payload.sig),
    );
    setVerdict(
      res.ok
        ? { admit: true, title: "Admit", detail: `Ticket #${payload.id} · ${preview?.signer ? who(preview.signer).name : ""}` }
        : { admit: false, title: "Do not admit", detail: res.error?.message, code: res.error?.code },
    );
  }

  function reset() {
    setPayload(null);
    setVerdict(null);
    setPasted("");
  }

  if (!info) return null;
  const sold = Number(info.totalMinted);
  const phase = phaseOf(info, now);
  // Ignore a code left over from earlier that has already expired.
  const shown = onScreen ? parse(onScreen) : null;
  const onScreenPayload = shown && shown.validUntil >= now ? shown : null;

  return (
    <div className="stack">
      <section className="card gate-head">
        <div>
          <h2>Door scanner</h2>
          <div className="muted">
            {isGate === false ? (
              <Badge tone="bad">Not appointed for this event: check-ins will be rejected</Badge>
            ) : (
              <Badge tone="good">Appointed gate staff</Badge>
            )}{" "}
            {phase === "over" && <Badge>Check-in window closed</Badge>}
            {phase === "cancelled" && <Badge tone="bad">Event cancelled</Badge>}
          </div>
        </div>
        <div className="gate-count">
          <div className="stat-value">
            {checkedIn} <span className="muted small">/ {sold} in</span>
          </div>
          <Progress value={checkedIn} max={Math.max(sold, 1)} tone="good" />
        </div>
      </section>

      <section className="card scanner">
        {verdict ? (
          <div className={`verdict ${verdict.admit ? "admit" : "deny"}`}>
            <div className="verdict-icon">{verdict.admit ? "✓" : "✗"}</div>
            <div className="verdict-title">{verdict.title}</div>
            {verdict.detail && <div className="verdict-detail">{verdict.detail}</div>}
            {verdict.code && <code className="small">{verdict.code}</code>}
            <button className="primary" onClick={reset}>
              Scan next
            </button>
          </div>
        ) : payload ? (
          <div className="scan-result">
            <h3>Ticket #{payload.id}</h3>
            <ul className="checklist">
              <Check ok={preview ? preview.genuine : null}>Genuine event on this platform</Check>
              <Check ok={preview ? !!preview.signer && sameAddr(preview.signer, preview.owner) : null}>
                {preview?.signer ? (
                  <>
                    Signed by <Person {...who(preview.signer)} />
                    {sameAddr(preview.signer, preview.owner) ? ", the current owner" : preview.owner ? `, but the owner is ${who(preview.owner).name}` : ""}
                  </>
                ) : (
                  "Signed by the current owner"
                )}
              </Check>
              <Check ok={preview ? preview.secondsLeft >= 0 : null}>
                {preview && preview.secondsLeft < 0 ? "Code expired: ask for a fresh one" : `Fresh code${preview ? ` (${preview.secondsLeft}s left)` : ""}`}
              </Check>
              <Check ok={preview ? !preview.used : null}>{preview?.used ? "Already scanned in" : "Not yet scanned in"}</Check>
            </ul>
            <p className="small muted">The contract re-checks all of this when you admit, so a fake can't get through even if this screen is wrong.</p>
            <div className="modal-actions">
              <button className="ghost" onClick={reset}>
                Cancel
              </button>
              <button className="primary big" onClick={admit}>
                Admit
              </button>
            </div>
          </div>
        ) : (
          <div className="scan-idle">
            <div className="viewfinder">
              <span />
              <div className="viewfinder-text">
                {onScreenPayload ? (
                  <>
                    A fan is showing ticket #{onScreenPayload.id}
                    <div className="small muted">Ask them to open "Show entry QR"</div>
                  </>
                ) : (
                  <>
                    Waiting for a QR code
                    <div className="small muted">As a fan, open a ticket and press "Show entry QR"</div>
                  </>
                )}
              </div>
            </div>
            <div className="scan-actions">
              <button className="primary big" disabled={!onScreenPayload} onClick={() => scan(onScreen)}>
                Scan QR on screen
              </button>
              <button className="link" onClick={() => setPasting(!pasting)}>
                {pasting ? "Hide" : "Paste a code instead"}
              </button>
            </div>
            {pasting && (
              <div className="paste">
                <textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"ticket":"0x…","id":"1","validUntil":…,"sig":"0x…"}' />
                <button className="secondary" disabled={!pasted.trim()} onClick={() => scan(pasted)}>
                  Check this code
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
