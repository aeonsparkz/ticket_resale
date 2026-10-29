// Demo-only time machine for the local node, so the event-time rules can be shown live.
import { useApp } from "../AppContext";
import { countdown, phaseOf, when, type Phase } from "../web3";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "onsale", label: "On sale" },
  { phase: "doors", label: "Event day" },
  { phase: "over", label: "Over" },
];

export function DemoBar() {
  const { read, info, now, refresh } = useApp();
  if (!info) return null;
  const phase = phaseOf(info, now);
  const closes = info.eventTime + info.checkinWindow;

  async function jumpTo(target: number) {
    await read.send("evm_setNextBlockTimestamp", [target]);
    await read.send("evm_mine", []);
    refresh();
  }

  const next =
    phase === "onsale"
      ? `Event starts in ${countdown(info.eventTime - now)}`
      : phase === "doors"
        ? `Check-in closes in ${countdown(closes - now)}`
        : phase === "cancelled"
          ? "Event cancelled"
          : "Tickets have expired";

  return (
    <footer className="demobar">
      <div className="demobar-inner">
        <span className="demo-tag">Demo time</span>
        <div className="timeline">
          {STEPS.map((s, i) => {
            const idx = STEPS.findIndex((x) => x.phase === phase);
            const state = phase === "cancelled" ? "" : i < idx ? "done" : i === idx ? "now" : "";
            return (
              <div key={s.phase} className={`tl-step ${state}`}>
                <span className="tl-dot" />
                {s.label}
              </div>
            );
          })}
        </div>
        <div className="demobar-time">
          <div>{when(now)}</div>
          <div className="muted small">{next}</div>
        </div>
        <div className="demobar-actions">
          <button className="ghost" onClick={() => jumpTo(now + 86400)}>
            +1 day
          </button>
          <button className="ghost" disabled={now >= info.eventTime} onClick={() => jumpTo(info.eventTime)}>
            Skip to event start
          </button>
          <button className="ghost" disabled={now >= closes} onClick={() => jumpTo(closes)}>
            Skip past check-in
          </button>
        </div>
      </div>
    </footer>
  );
}
