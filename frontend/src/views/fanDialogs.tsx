// Fan dialogs: selling (with payout breakdown), buying (with checks and the atomic swap
// explained), and the rotating entry QR.
import { useCallback, useEffect, useState } from "react";
import { ZeroAddress, formatEther, getBytes, isAddress, parseEther } from "ethers";
import { QRCodeSVG } from "qrcode.react";
import { useApp } from "../AppContext";
import { chainNow, eth, getContracts, pct, sameAddr } from "../web3";
import { Avatar, Check, Modal, Person } from "../components/ui";
import { publishQr } from "../qrShare";

export type Listing = { id: bigint; seller: string; price: bigint; allowedBuyer: string };

const QR_SECONDS = 30;

export function SellDialog({ id, current, onClose }: { id: bigint; current: Listing | null; onClose: () => void }) {
  const { d, signer, me, eventAddr, info, people, run } = useApp();
  const face = info!.faceValue;
  const cap = info!.maxResalePrice;
  const [price, setPrice] = useState<bigint>(current?.price ?? cap);
  const [text, setText] = useState(formatEther(current?.price ?? cap));
  const initialBuyer = current && current.allowedBuyer !== ZeroAddress ? current.allowedBuyer : "";
  const [buyerMode, setBuyerMode] = useState<"anyone" | "person">(initialBuyer ? "person" : "anyone");
  const [buyer, setBuyer] = useState(initialBuyer || people.find((p) => p.role === "fan" && !sameAddr(p.address, me))?.address || "");

  const royalty = (price * info!.royaltyBps) / 10_000n;
  const overCap = price > cap;
  const pctOfFace = face > 0n ? Number((price * 100n) / face) : 0;
  const capPct = Number(info!.resaleCapBps) / 100;
  const buyerOk = buyerMode === "anyone" || isAddress(buyer);
  const candidates = people.filter((p) => p.role === "fan" && !sameAddr(p.address, me));

  function setFromText(v: string) {
    setText(v);
    try {
      setPrice(parseEther(v || "0"));
    } catch {
      // keep the last valid price while typing
    }
  }
  function setFromSlider(p: number) {
    const wei = (face * BigInt(p)) / 100n;
    setPrice(wei);
    setText(formatEther(wei));
  }

  async function submit() {
    const res = await run({ pending: "Listing your ticket…", success: `Ticket #${id} is listed for ${eth(price)}` }, () =>
      getContracts(d, signer).marketplace.list(eventAddr, id, price, buyerMode === "anyone" ? ZeroAddress : buyer),
    );
    if (res.ok) onClose();
  }

  return (
    <Modal title={`Sell ticket #${id}`} onClose={onClose}>
      <div className="field">
        <label>Price</label>
        <div className="price-input">
          <input value={text} onChange={(e) => setFromText(e.target.value)} inputMode="decimal" />
          <span>ETH</span>
        </div>
        <input
          type="range"
          min={10}
          max={Math.ceil(capPct * 1.2)}
          value={Math.min(pctOfFace, Math.ceil(capPct * 1.2))}
          onChange={(e) => setFromSlider(Number(e.target.value))}
          className={overCap ? "range over" : "range"}
        />
        <div className="range-labels small muted">
          <span>{pctOfFace}% of face value</span>
          <span>cap: {eth(cap)}</span>
        </div>
        {overCap && (
          <div className="callout bad">
            Above the organizer's {pct(info!.resaleCapBps)} cap. The contract will reject this listing, wherever the buyer was found.
          </div>
        )}
      </div>

      <div className="field">
        <label>Who can buy it?</label>
        <div className="segmented full">
          <button className={buyerMode === "anyone" ? "active" : ""} onClick={() => setBuyerMode("anyone")}>
            Anyone
          </button>
          <button className={buyerMode === "person" ? "active" : ""} onClick={() => setBuyerMode("person")}>
            One specific buyer
          </button>
        </div>
        {buyerMode === "person" && (
          <>
            <p className="small muted">Agreed a deal on Telegram or Carousell? Reserve it so nobody else can take it.</p>
            <div className="chips">
              {candidates.map((p) => (
                <button key={p.address} className={`chip ${sameAddr(buyer, p.address) ? "active" : ""}`} onClick={() => setBuyer(p.address)}>
                  <Avatar name={p.name} color={p.color} size={20} /> {p.name}
                </button>
              ))}
            </div>
            <input className="full" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="or paste a wallet address 0x…" />
          </>
        )}
      </div>

      <div className="breakdown">
        <div className="row-between">
          <span>Buyer pays</span>
          <strong>{eth(price)}</strong>
        </div>
        <div className="row-between muted">
          <span>Organizer royalty ({pct(info!.royaltyBps)})</span>
          <span>− {eth(royalty)}</span>
        </div>
        <div className="row-between total">
          <span>You receive</span>
          <strong>{eth(price - royalty)}</strong>
        </div>
        <p className="small muted">Your ticket stays in your wallet until someone buys it. Payment and ticket then swap in one transaction.</p>
      </div>

      <div className="modal-actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" disabled={!buyerOk || price === 0n} onClick={submit}>
          {current ? "Update listing" : "List for sale"}
        </button>
      </div>
    </Modal>
  );
}

export function BuyDialog({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const { d, read, signer, me, eventAddr, info, who, run } = useApp();
  const [checks, setChecks] = useState<{ genuine: boolean; owned: boolean; unused: boolean } | null>(null);
  const royalty = (listing.price * info!.royaltyBps) / 10_000n;
  const reserved = listing.allowedBuyer !== ZeroAddress;
  const allowed = !reserved || sameAddr(listing.allowedBuyer, me);

  useEffect(() => {
    const { factory, ticket } = getContracts(d, read);
    const t = ticket(eventAddr);
    (async () => {
      const [genuine, owner, used] = await Promise.all([factory.isTicket(eventAddr), t.ownerOf(listing.id), t.used(listing.id)]);
      setChecks({ genuine, owned: sameAddr(owner, listing.seller), unused: !used });
    })().catch(() => {});
  }, [d, read, eventAddr, listing]);

  async function submit() {
    const res = await run({ pending: `Buying ticket #${listing.id}…`, success: `Ticket #${listing.id} is yours` }, () =>
      getContracts(d, signer).marketplace.buy(eventAddr, listing.id, { value: listing.price }),
    );
    if (res.ok) onClose();
  }

  return (
    <Modal title={`Buy ticket #${listing.id}`} onClose={onClose}>
      <p>
        From <Person {...who(listing.seller)} /> for <strong>{eth(listing.price)}</strong>
      </p>

      <div className="field">
        <label>Checked on the blockchain</label>
        <ul className="checklist">
          <Check ok={checks?.genuine ?? null}>Genuine ticket for {info!.name}</Check>
          <Check ok={checks?.owned ?? null}>{who(listing.seller).name} really owns it</Check>
          <Check ok={checks?.unused ?? null}>Not yet used at the door</Check>
          <Check ok={listing.price <= info!.maxResalePrice}>Within the {eth(info!.maxResalePrice)} price cap</Check>
          {reserved && <Check ok={allowed}>Reserved for {who(listing.allowedBuyer).name}</Check>}
        </ul>
      </div>

      <div className="swap">
        <div className="swap-title">All of this happens in one transaction, or none of it does:</div>
        <ol>
          <li>
            You pay <strong>{eth(listing.price)}</strong>
          </li>
          <li>
            {who(listing.seller).name} receives <strong>{eth(listing.price - royalty)}</strong>
          </li>
          <li>
            The organizer receives a <strong>{eth(royalty)}</strong> royalty
          </li>
          <li>
            Ticket #{listing.id.toString()} moves to your wallet
          </li>
        </ol>
      </div>

      {!allowed && <div className="callout warn">This listing is reserved for {who(listing.allowedBuyer).name}. The contract will reject anyone else.</div>}

      <div className="modal-actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button className={allowed ? "primary" : "danger"} onClick={submit}>
          {allowed ? `Pay ${eth(listing.price)}` : "Try to buy anyway"}
        </button>
      </div>
    </Modal>
  );
}

/// The rotating QR: the holder signs (ticket contract, chain id, id, validUntil). With the demo
/// accounts it re-signs automatically every 30s; with MetaMask each refresh is a signature popup.
export function QrDialog({ id, onClose }: { id: bigint; onClose: () => void }) {
  const { d, read, signer, mode, eventAddr, me, info, who } = useApp();
  const [payload, setPayload] = useState("");
  const [expiresAt, setExpiresAt] = useState(0); // wall-clock ms
  const [left, setLeft] = useState(QR_SECONDS);
  const [error, setError] = useState("");

  const sign = useCallback(async () => {
    try {
      const validUntil = (await chainNow(read)) + QR_SECONDS;
      const hash: string = await getContracts(d, read).ticket(eventAddr).checkInHash(id, validUntil);
      const sig = await signer.signMessage(getBytes(hash));
      const p = JSON.stringify({ ticket: eventAddr, id: id.toString(), validUntil, sig });
      setPayload(p);
      setExpiresAt(Date.now() + QR_SECONDS * 1000);
      setError("");
      publishQr(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [d, read, signer, eventAddr, id]);

  useEffect(() => {
    sign();
  }, [sign]);

  useEffect(() => {
    const tick = setInterval(() => {
      const s = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && mode === "local" && expiresAt) sign();
    }, 250);
    return () => clearInterval(tick);
  }, [expiresAt, mode, sign]);

  return (
    <Modal title="Entry QR" onClose={onClose}>
      <div className="qr-wrap">
        <div className="qr-head">
          <div className="stub-event">{info!.name}</div>
          <div className="muted small">
            Ticket #{id.toString()} · <Person {...who(me)} />
          </div>
        </div>
        <div className={`qr-box ${left === 0 ? "expired" : ""}`}>{payload ? <QRCodeSVG value={payload} size={220} /> : <div className="spinner big" />}</div>
        <div className="qr-timer">
          <div className="progress">
            <div className="progress-fill good" style={{ width: `${(left / QR_SECONDS) * 100}%` }} />
          </div>
          <span className="small muted">
            {left > 0 ? `Refreshes in ${left}s` : mode === "local" ? "Refreshing…" : "Expired"}
          </span>
        </div>
        {error && <div className="callout bad">{error}</div>}
        {mode === "metamask" && left === 0 && (
          <button className="primary" onClick={sign}>
            Sign a fresh code
          </button>
        )}
        <p className="small muted">
          Signed by your wallet just now. It only works while you own this ticket, so a screenshot is useless once the code
          expires or the ticket is sold.
        </p>
        <button className="link" onClick={() => navigator.clipboard.writeText(payload)}>
          Copy code as text
        </button>
      </div>
    </Modal>
  );
}
