import Link from "next/link";
import { currentViewer } from "@/lib/orders/session";
import { listOrders, counts, settings, type Tab } from "@/lib/orders/service";
import { STAGE_LABEL, type Stage } from "@/lib/orders/rules";
import { money } from "@/lib/brand";
import { StagePill, stageColour, ago, day } from "../ui";

type P = { searchParams: Promise<{ tab?: string; stage?: string; q?: string }> };
const FILTERS: (Stage | "flagged")[] = ["flagged", "submitted", "verified", "in_progress"];

/** The order list. Staff see every dealer; dealers see their own. Flagged orders come first. */
export default async function Orders({ searchParams }: P) {
  const v = (await currentViewer())!;
  const sp = await searchParams;
  const tab: Tab = sp.tab === "archive" ? "archive" : "open";
  const stage = FILTERS.includes(sp.stage as Stage) || sp.stage === "shipped" ? (sp.stage as Stage | "flagged") : undefined;
  const q = sp.q?.slice(0, 80) ?? "";
  const [list, c, s] = await Promise.all([listOrders(v, tab, { q, stage: tab === "open" ? stage : undefined }), counts(v), settings()]);
  const staff = v.role !== "dealer";
  const href = (p: Record<string, string | undefined>) => "/orders?" + new URLSearchParams(Object.entries({ q: q || undefined, ...p }).filter(([, x]) => x) as [string, string][]).toString();

  return (
    <div className="body">
      <div className="bar">
        <h1 style={{ fontSize: 30 }}>{staff ? (tab === "archive" ? "Archive" : "Dealer orders") : tab === "archive" ? "Finished orders" : "My orders"}</h1>
        {!staff && s.shopUrl && <a className="btn big" href={s.shopUrl}>New order</a>}
      </div>

      <nav className="tabs" aria-label="Show">
        <Link href={href({})} aria-current={tab === "open" && !stage ? "page" : undefined}>Open <small>{c.all ?? 0}</small></Link>
        {staff && FILTERS.map((f) => {
          const count = c[f] ?? 0;
          if (f === "flagged" && !count) return null;
          return (
            <Link key={f} href={href({ stage: f })} className={f === "flagged" ? "flagtab" : undefined} aria-current={tab === "open" && stage === f ? "page" : undefined}>
              {f !== "flagged" && <i style={{ background: `var(--st-${f})` }} />}
              {f === "flagged" ? "Needs attention" : STAGE_LABEL[f]} <small>{count}</small>
            </Link>
          );
        })}
        <Link href={href({ tab: "archive" })} aria-current={tab === "archive" ? "page" : undefined}>{staff ? "Archive" : "Finished"}</Link>
      </nav>

      <form className="search" action="/orders">
        {tab === "archive" && <input type="hidden" name="tab" value="archive" />}
        <input name="q" defaultValue={q} placeholder={staff ? "Order number, dealer or part number" : "Order number or part number"} aria-label="Search orders" />
        <button className="btn ghost">Search</button>
      </form>

      {list.length === 0 ? (
        <div className="empty">{q ? "No orders match that search." : tab === "archive" ? "Nothing here yet." : staff ? "No open orders. All caught up." : "No open orders. Use New order to order parts from the website."}</div>
      ) : (
        <div className="list">
          {list.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className={"card" + (o.flag.flagged ? " flagged" : "")} style={stageColour(o.stage)}>
              <i />
              <div className="main">
                <div className="l1"><b>#{o.number}</b>{staff && <span>{o.dealerName}</span>}</div>
                <div className="l2">
                  Ordered {day(o.orderedAt)} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                  {o.stage !== "received" && o.stage !== "cancelled" && <> · {ago(o.stageSince)} at {STAGE_LABEL[o.stage]}</>}
                  {staff && o.dealerCountry && <> · {o.dealerCountry}</>}
                </div>
                <div className="badges">
                  {o.flag.flagged && <span className="badge flag">⚑ {o.flag.reason}</span>}
                  {o.pendingProposal && <span className="badge wait">{staff ? "Waiting for dealer approval" : "Please approve changes"}</span>}
                  {staff && o.openIssues > 0 && <span className="badge wait">Problem raised</span>}
                  {o.stage === "in_progress" && o.shipments > 0 && <span className="badge">Part shipped ({o.shipments})</span>}
                  {o.eta && !o.flag.flagged && o.stage !== "received" && <span className="badge">Est. {day(o.eta)}</span>}
                  {o.stage === "shipped" && !staff && <span className="badge wait">Press Received when it arrives</span>}
                  {o.receivedAuto && <span className="badge">Closed, not confirmed</span>}
                  {o.receivedCondition && o.receivedCondition !== "ok" && <span className="badge flag">{o.receivedCondition === "damaged" ? "Damaged on arrival" : "Items missing"}</span>}
                  {staff && o.dealerNeedsSetup && <span className="badge wait">New dealer: set up</span>}
                  {staff && (o.stage === "shipped" || o.stage === "received") && !o.invoiceNumber && <span className="badge">Not invoiced</span>}
                  {staff && o.invoiceNumber && <span className="badge ok">Invoice {o.invoiceNumber}</span>}
                </div>
              </div>
              <div className="side">
                <StagePill stage={o.stage} />
                <span className="amt">{money(o.totalCents, o.currency)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
