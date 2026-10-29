// Small presentational building blocks shared by every view.
import { useEffect, type ReactNode } from "react";

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Person({ name, color }: { name: string; color: string }) {
  return (
    <span className="person">
      <Avatar name={name} color={color} size={20} />
      {name}
    </span>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "good" | "bad" | "info" | "warn" | "neutral"; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Progress({ value, max, tone = "info" }: { value: number; max: number; tone?: string }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="progress">
      <div className={`progress-fill ${tone}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onMouseDown={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/// A ✓ / ✗ checklist row.
export function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <li className={`check ${ok === null ? "" : ok ? "ok" : "fail"}`}>
      <span className="check-mark">{ok === null ? "…" : ok ? "✓" : "✗"}</span>
      <span>{children}</span>
    </li>
  );
}

export type Toast = { id: number; kind: "pending" | "ok" | "error"; title: string; code?: string };

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="toast-icon">{t.kind === "pending" ? <span className="spinner" /> : t.kind === "ok" ? "✓" : "!"}</span>
          <div className="toast-body">
            <div>{t.title}</div>
            {t.code && <code className="toast-code">{t.code}</code>}
          </div>
          {t.kind !== "pending" && (
            <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
