// What a buyer on Telegram can check before paying: genuine contract, owner, validity, listing.
import { useEffect, useState } from "react";
import { ZeroAddress, isAddress } from "ethers";
import { useApp } from "../AppContext";
import { eth, getContracts } from "../web3";
import { Check, Person } from "./ui";

type Result =
  | { kind: "fake" }
  | { kind: "missing"; name: string }
  | {
      kind: "found";
      name: string;
      owner: string;
      valid: boolean;
      used: boolean;
      listing: { price: bigint; allowedBuyer: string } | null;
    };

export function TicketCheck() {
  const { d, read, eventAddr, who } = useApp();
  const [addr, setAddr] = useState(eventAddr);
  const [id, setId] = useState("1");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => setAddr(eventAddr), [eventAddr]);

  async function check() {
    const { factory, ticket, marketplace } = getContracts(d, read);
    if (!isAddress(addr) || !(await factory.isTicket(addr))) return setResult({ kind: "fake" });
    const t = ticket(addr);
    const name: string = await t.name();
    const owner = await t.ownerOf(BigInt(id || "0")).catch(() => null);
    if (!owner) return setResult({ kind: "missing", name });
    const [valid, used, l] = await Promise.all([t.isValid(BigInt(id)), t.used(BigInt(id)), marketplace.getListing(addr, BigInt(id))]);
    setResult({
      kind: "found",
      name,
      owner,
      valid,
      used,
      listing: l.seller === ZeroAddress ? null : { price: l.price, allowedBuyer: l.allowedBuyer },
    });
  }

  return (
    <section className="card check-card">
      <div className="check-intro">
        <h2>Buying off-platform? Check the ticket first.</h2>
        <p className="muted">
          A seller on Telegram or Carousell can send you the event address and ticket number. Anyone can check them on the
          blockchain, with no account.
        </p>
        <div className="check-form">
          <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Event contract address 0x…" />
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Ticket #" className="narrow" />
          <button className="primary" onClick={check}>
            Check
          </button>
        </div>
      </div>
      {result && (
        <ul className="checklist result">
          {result.kind === "fake" && <Check ok={false}>Not a genuine event on this platform. Don't pay.</Check>}
          {result.kind === "missing" && (
            <>
              <Check ok={true}>Genuine event: {result.name}</Check>
              <Check ok={false}>Ticket #{id} doesn't exist (or was refunded)</Check>
            </>
          )}
          {result.kind === "found" && (
            <>
              <Check ok={true}>Genuine event: {result.name}</Check>
              <Check ok={true}>
                Owned by <Person {...who(result.owner)} />
              </Check>
              <Check ok={result.valid}>{result.valid ? "Valid: not used and not expired" : result.used ? "Already used at the door" : "Not valid (expired or event cancelled)"}</Check>
              <Check ok={result.listing !== null}>
                {result.listing ? (
                  <>
                    Listed for {eth(result.listing.price)}
                    {result.listing.allowedBuyer !== ZeroAddress && <> · reserved for {who(result.listing.allowedBuyer).name}</>}
                  </>
                ) : (
                  "Not listed for sale yet. Ask the seller to list it for you."
                )}
              </Check>
            </>
          )}
        </ul>
      )}
    </section>
  );
}
