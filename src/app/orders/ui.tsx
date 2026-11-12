import { STAGES, STAGE_LABEL, type Stage } from "@/lib/orders/rules";

/** Colour for a stage, as a CSS variable set on the element (the stylesheet picks it up as --c). */
export const stageColour = (s: Stage) => ({ ["--c" as string]: `var(--st-${s})` }) as React.CSSProperties;

export function StagePill({ stage }: { stage: Stage }) {
  return <span className="pill" style={stageColour(stage)}>{STAGE_LABEL[stage]}</span>;
}

/** The five stages as a progress bar, coloured up to where the order is. */
export function Tracker({ stage }: { stage: Stage }) {
  if (stage === "cancelled") return null;
  const at = STAGES.indexOf(stage);
  return (
    <div className="track" aria-label={`Stage ${at + 1} of 5: ${STAGE_LABEL[stage]}`}>
      {/* each step keeps its own colour, so the bar reads blue → purple → amber → green → grey */}
      {STAGES.map((s, i) => <div key={s} style={stageColour(s)} className={i < at ? "done" : i === at ? "now" : ""}>{STAGE_LABEL[s]}</div>)}
    </div>
  );
}

export const when = (d: Date | string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
export const day = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
export const ago = (d: Date | string) => {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days <= 0 ? "under a day" : days === 1 ? "1 day" : `${days} days`;
};

/** The TOM logo: T, a ticked O, M. Letters take the text colour; the tick is green. */
export function TomLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size * 2.6} height={size} viewBox="0 0 104 40" role="img" aria-label="TOM" style={{ display: "block", flex: "none" }}>
      <path d="M0 2h28v8h-9.5v28h-9V10H0z" fill="currentColor" />
      <circle cx="51" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="7" />
      <path d="M43.5 20.5l5 5 10-11" fill="none" stroke="#3CC273" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M74 38V2h10l6 17 6-17h8v36h-8.5V18l-4.5 13h-3l-4.5-13v20z" fill="currentColor" />
    </svg>
  );
}
