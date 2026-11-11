import type { EventInfo } from "./event";

/** The event's own colours, applied as CSS variables (white label). Only plain hex colours are accepted. */
export function brandStyle(ev: Pick<EventInfo, "brand">): React.CSSProperties {
  const hex = (v?: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  const s: Record<string, string> = {};
  if (hex(ev.brand.primary)) s["--brand"] = ev.brand.primary!;
  if (hex(ev.brand.accent)) s["--accent"] = ev.brand.accent!;
  return s as React.CSSProperties;
}
export const money = (cents: number, currency = "EUR") =>
  (cents / 100).toLocaleString("en-IE", { style: "currency", currency, minimumFractionDigits: 2 });
