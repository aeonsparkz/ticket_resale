// The event banner every view shows: name, date, countdown, rules and availability.
import { useApp } from "../AppContext";
import { countdown, eth, pct, phaseOf, when } from "../web3";
import { Badge, Person, Progress } from "./ui";

export function EventHero() {
  const { info, now, who } = useApp();
  if (!info) return null;
  const phase = phaseOf(info, now);
  const sold = Number(info.totalMinted);
  const supply = Number(info.maxSupply);

  const status = {
    onsale: <Badge tone="good">On sale · starts in {countdown(info.eventTime - now)}</Badge>,
    doors: <Badge tone="info">Doors open · check-in closes in {countdown(info.eventTime + info.checkinWindow - now)}</Badge>,
    over: <Badge>Event over · unscanned tickets expired</Badge>,
    cancelled: <Badge tone="bad">Cancelled · refunds available</Badge>,
  }[phase];

  return (
    <section className="hero">
      <div className="hero-main">
        <div className="hero-eyebrow">{when(info.eventTime)}</div>
        <h1 className="hero-title">{info.name}</h1>
        <div className="hero-meta">
          {status}
          <span className="muted">
            by <Person {...who(info.organizer)} />
          </span>
        </div>
      </div>
      <div className="hero-facts">
        <div>
          <div className="fact-label">Face value</div>
          <div className="fact-value">{eth(info.faceValue)}</div>
        </div>
        <div>
          <div className="fact-label">Resale cap</div>
          <div className="fact-value">{eth(info.maxResalePrice)}</div>
          <div className="fact-sub">{pct(info.resaleCapBps)} of face</div>
        </div>
        <div>
          <div className="fact-label">Organizer royalty</div>
          <div className="fact-value">{pct(info.royaltyBps)}</div>
          <div className="fact-sub">of every resale</div>
        </div>
        <div className="fact-wide">
          <div className="fact-label">
            {sold} / {supply} sold
          </div>
          <Progress value={sold} max={supply} tone={sold >= supply ? "bad" : "good"} />
        </div>
      </div>
    </section>
  );
}
