import { useEffect, useState } from "react";
import { ZeroAddress, type EventLog } from "ethers";
import { useApp } from "../AppContext";
import { eth, getContracts, phaseOf, sameAddr, when } from "../web3";
import { Badge, Empty, Person } from "../components/ui";
import { TicketCheck } from "../components/TicketCheck";
import { BuyDialog, QrDialog, SellDialog, type Listing } from "./fanDialogs";

type MyTicket = { id: bigint; used: boolean; valid: boolean; listing: Listing | null };

export function FanView() {
  const { d, read, me, eventAddr, version } = useApp();
  const [mine, setMine] = useState<MyTicket[]>([]);
  const [market, setMarket] = useState<Listing[]>([]);
  const [bought, setBought] = useState(0n);

  useEffect(() => {
    const { ticket, marketplace } = getContracts(d, read);
    const t = ticket(eventAddr);
    (async () => {
      setBought(await t.primaryPurchases(me));

      // ERC-721 has no "tokens of owner" list, so rebuild it from Transfer events.
      const received = (await t.queryFilter(t.filters.Transfer(null, me), 0)) as EventLog[];
      const ids = [...new Set(received.map((l) => l.args.tokenId as bigint))];
      const owned: MyTicket[] = [];
      for (const id of ids) {
        const owner = await t.ownerOf(id).catch(() => null); // refunded tickets are burned
        if (!sameAddr(owner, me)) continue;
        const l = await marketplace.getListing(eventAddr, id);
        owned.push({
          id,
          used: await t.used(id),
          valid: await t.isValid(id),
          listing: l.seller === ZeroAddress ? null : { id, seller: l.seller, price: l.price, allowedBuyer: l.allowedBuyer },
        });
      }
      setMine(owned.sort((a, b) => Number(a.id - b.id)));

      // Open listings: every Listed event for this event, keeping the ones still on the books.
      const listed = (await marketplace.queryFilter(marketplace.filters.Listed(eventAddr), 0)) as EventLog[];
      const open: Listing[] = [];
      for (const id of new Set(listed.map((l) => l.args.id as bigint))) {
        const l = await marketplace.getListing(eventAddr, id);
        if (l.seller !== ZeroAddress) open.push({ id, seller: l.seller, price: l.price, allowedBuyer: l.allowedBuyer });
      }
      setMarket(open.sort((a, b) => Number(a.id - b.id)));
    })().catch(() => {});
  }, [d, read, me, eventAddr, version]);

  return (
    <div className="stack">
      <BuyFromOrganizer bought={bought} />
      <div className="two-col">
        <MyTickets tickets={mine} />
        <Market listings={market} />
      </div>
      <TicketCheck />
    </div>
  );
}

function BuyFromOrganizer({ bought }: { bought: bigint }) {
  const { d, signer, eventAddr, info, run } = useApp();
  const [qty, setQty] = useState(1);
  if (!info) return null;

  const left = Number(info.maxSupply - info.totalMinted);
  const allowance = Number(info.maxPerWallet - bought);
  const max = Math.max(0, Math.min(left, allowance));
  const q = Math.min(Math.max(qty, 1), Math.max(max, 1));
  const total = info.faceValue * BigInt(q);

  let note = `Max ${info.maxPerWallet} per person. You've bought ${bought} so far.`;
  if (!info.tradingOpen) note = info.cancelled ? "This event was cancelled." : "Sales closed when the event started.";
  else if (left === 0) note = "Sold out. Check the resale market below.";
  else if (allowance <= 0) note = `You've reached the limit of ${info.maxPerWallet} per person.`;

  return (
    <section className="card buy-box">
      <div>
        <h2>Buy from the organizer</h2>
        <p className="muted">{note}</p>
      </div>
      <div className="buy-controls">
        <div className="stepper">
          <button onClick={() => setQty(Math.max(1, q - 1))} disabled={q <= 1}>
            −
          </button>
          <span>{q}</span>
          <button onClick={() => setQty(q + 1)} disabled={q >= max}>
            +
          </button>
        </div>
        <button
          className="primary"
          disabled={!info.tradingOpen || max === 0}
          onClick={() =>
            run({ pending: `Buying ${q} ticket${q > 1 ? "s" : ""}…`, success: `You bought ${q} ticket${q > 1 ? "s" : ""}` }, () =>
              getContracts(d, signer).ticket(eventAddr).buy(BigInt(q), { value: total }),
            )
          }
        >
          Buy for {eth(total)}
        </button>
      </div>
    </section>
  );
}

function MyTickets({ tickets }: { tickets: MyTicket[] }) {
  const { d, signer, eventAddr, info, now, run, who } = useApp();
  const [selling, setSelling] = useState<MyTicket | null>(null);
  const [showing, setShowing] = useState<bigint | null>(null);
  if (!info) return null;
  const phase = phaseOf(info, now);
  const { ticket, marketplace } = getContracts(d, signer);

  return (
    <section className="card">
      <div className="card-head">
        <h2>My tickets</h2>
        <span className="muted small">{tickets.length} held</span>
      </div>
      {tickets.length === 0 && <Empty title="No tickets yet">Buy from the organizer, or from someone on the resale market.</Empty>}
      <div className="stubs">
        {tickets.map((tk) => {
          const status = info.cancelled ? (
            <Badge tone="bad">Event cancelled</Badge>
          ) : tk.used ? (
            <Badge>Checked in</Badge>
          ) : !tk.valid ? (
            <Badge>Expired</Badge>
          ) : tk.listing ? (
            <Badge tone="info">For sale</Badge>
          ) : (
            <Badge tone="good">Valid</Badge>
          );
          return (
            <div key={tk.id.toString()} className={`stub ${tk.valid || info.cancelled ? "" : "dim"}`}>
              <div className="stub-body">
                <div className="stub-event">{info.name}</div>
                <div className="stub-date">{when(info.eventTime)}</div>
                <div className="stub-status">
                  {status}
                  {tk.listing && (
                    <span className="small muted">
                      {eth(tk.listing.price)}
                      {tk.listing.allowedBuyer !== ZeroAddress && <> · only for {who(tk.listing.allowedBuyer).name}</>}
                    </span>
                  )}
                </div>
                <div className="stub-actions">
                  {info.cancelled ? (
                    <button
                      className="primary"
                      onClick={() =>
                        run({ pending: "Claiming refund…", success: `Refunded ${eth(info.faceValue)}` }, () => ticket(eventAddr).claimRefund(tk.id))
                      }
                    >
                      Claim {eth(info.faceValue)} refund
                    </button>
                  ) : (
                    <>
                      {tk.valid && (phase === "onsale" || phase === "doors") && (
                        <button className="primary" onClick={() => setShowing(tk.id)}>
                          Show entry QR
                        </button>
                      )}
                      {info.tradingOpen && !tk.used && (
                        <button className="secondary" onClick={() => setSelling(tk)}>
                          {tk.listing ? "Edit listing" : "Sell"}
                        </button>
                      )}
                      {tk.listing && (
                        <button
                          className="ghost"
                          onClick={() =>
                            run({ pending: "Taking listing down…", success: `#${tk.id} is no longer for sale` }, () =>
                              marketplace.cancel(eventAddr, tk.id),
                            )
                          }
                        >
                          Take down
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="stub-tear">
                <span className="stub-no">#{tk.id.toString()}</span>
                <span className="stub-admit">ADMIT ONE</span>
              </div>
            </div>
          );
        })}
      </div>
      {selling && <SellDialog id={selling.id} current={selling.listing} onClose={() => setSelling(null)} />}
      {showing !== null && <QrDialog id={showing} onClose={() => setShowing(null)} />}
    </section>
  );
}

function Market({ listings }: { listings: Listing[] }) {
  const { me, info, who } = useApp();
  const [buying, setBuying] = useState<Listing | null>(null);
  if (!info) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Resale market</h2>
        <span className="muted small">capped at {eth(info.maxResalePrice)}</span>
      </div>
      {listings.length === 0 && <Empty title="Nothing for sale">When fans resell tickets, they appear here.</Empty>}
      <div className="listings">
        {listings.map((l) => {
          const mine = sameAddr(l.seller, me);
          const reserved = l.allowedBuyer !== ZeroAddress;
          const forMe = reserved && sameAddr(l.allowedBuyer, me);
          const markup = Number(((l.price - info.faceValue) * 10000n) / info.faceValue) / 100;
          return (
            <div key={l.id.toString()} className={`listing ${forMe ? "for-me" : ""}`}>
              <div className="listing-main">
                <div className="listing-top">
                  <span className="listing-id">Ticket #{l.id.toString()}</span>
                  <Badge tone="good">✓ Genuine</Badge>
                  {reserved && <Badge tone={forMe ? "info" : "warn"}>{forMe ? "Reserved for you" : `Reserved for ${who(l.allowedBuyer).name}`}</Badge>}
                </div>
                <div className="listing-seller">
                  Sold by <Person {...who(l.seller)} />
                </div>
              </div>
              <div className="listing-buy">
                <div className="listing-price">{eth(l.price)}</div>
                <div className="small muted">{markup === 0 ? "face value" : `${markup > 0 ? "+" : ""}${markup}% vs face`}</div>
                {mine ? (
                  <Badge>Your listing</Badge>
                ) : (
                  <button className={reserved && !forMe ? "secondary" : "primary"} disabled={!info.tradingOpen} onClick={() => setBuying(l)}>
                    {info.tradingOpen ? "Buy" : "Closed"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {buying && <BuyDialog listing={buying} onClose={() => setBuying(null)} />}
    </section>
  );
}
