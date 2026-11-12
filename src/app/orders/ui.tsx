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
