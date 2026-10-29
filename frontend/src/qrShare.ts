// Simulated camera: the fan's QR dialog publishes its current code, and the gate scanner can
// "scan" it, in the same window or another window on the same browser.
const KEY = "ticket-resale:last-qr";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(KEY) : null;

export function publishQr(payload: string) {
  try {
    localStorage.setItem(KEY, payload);
  } catch {
    // storage unavailable: the cross-window channel still works
  }
  channel?.postMessage(payload);
}

export function latestQr(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function onQr(cb: (payload: string) => void) {
  const handler = (e: MessageEvent) => cb(String(e.data));
  channel?.addEventListener("message", handler);
  return () => channel?.removeEventListener("message", handler);
}
