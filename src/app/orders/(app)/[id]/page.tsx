import Link from "next/link";
import { notFound } from "next/navigation";
import { currentViewer } from "@/lib/orders/session";
import { getOrder, markRead } from "@/lib/orders/service";
import { can, fmtDate, linesTotal, STAGE_LABEL, type Action, type Line } from "@/lib/orders/rules";
import { money } from "@/lib/brand";
import { StagePill, Tracker, when, day, ago } from "../../ui";
import * as A from "../../actions";

type P = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; edit?: string; reorder?: string }> };

const ACTIVITY: Record<string, string> = {
  arrived: "Order arrived", "stage:verified": "Verified", "stage:in_progress": "Marked in progress", "stage:shipped": "Shipped",
  "stage:received": "Received", "stage:cancelled": "Cancelled", "stage:submitted": "Back to submitted",
  edit_sent: "Changes sent to the dealer", edit_withdrawn: "Changes withdrawn", edit_approved: "Dealer approved the changes", edit_queried: "Dealer queried the changes",
  issue_raised: "Problem raised", issue_resolved: "Problem resolved", delay_notice: "Delay notice sent", shipment_added: "Parcel shipped",
  invoiced: "Invoice number added", invoice_cleared: "Invoice number cleared", changed_on_website: "Changed on the website", website_update_failed: "Website update failed",
};

function addr(a: Record<string, string> | null) {
  if (!a) return null;
  return [[a.first_name, a.last_name].filter(Boolean).join(" "), a.company, a.address_1, a.address_2, [a.postcode, a.city].filter(Boolean).join(" "), a.state, a.country].filter(Boolean).join(", ");
}

export default async function OrderPage({ params, searchParams }: P) {
  const { id } = await params;
  const sp = await searchParams;
  const v = (await currentViewer())!;
  const d = await getOrder(v, id);
  if (!d) notFound();
  await markRead(v, id);
  const { order: o, lines, pending, ctx } = d;
  const c = (a: Action) => can(a, ctx);
  const staff = v.role !== "dealer";
  const editing = sp.edit === "1" && c("propose_edit");
  const reordering = sp.reorder === "1" && (v.role === "dealer" || v.role === "admin");
  const failedPush = d.proposals.find((p) => p.status === "approved" && !p.pushed_at && p.push_error);
  const openIssues = d.issues.filter((i) => !i.resolved_at);
  const cur = o.currency;
  const hid = <input type="hidden" name="id" value={o.id} />;

  return (
    <div className="body">
      <Link href="/orders" className="hint" style={{ textDecoration: "none" }}>← All orders</Link>
      <div className="bar">
        <div>
          <h1 style={{ fontSize: 34 }}>Order #{o.number}</h1>
          <div className="hint">{staff ? `${o.dealerName}${o.dealerCountry ? ` · ${o.dealerCountry}` : ""} · ` : ""}ordered {day(o.orderedAt)}</div>
        </div>
        <StagePill stage={o.stage} />
      </div>

      {sp.ok && <div className="note ok" role="status">{sp.ok}</div>}
      {sp.err && <div className="note err" role="alert">{sp.err}</div>}
      {staff && o.flag.flagged && <div className="flagbar">⚑ Needs attention: {o.flag.reason}. Someone should look into this order.</div>}
      <Tracker stage={o.stage} />
      {o.stage === "cancelled" && <div className="note err">Cancelled{o.cancelledReason ? `: ${o.cancelledReason}` : ""}</div>}
      {o.eta && o.stage !== "received" && o.stage !== "cancelled" && (
        <div className="note wait">{o.stage === "shipped" ? "Estimated delivery" : "Estimated shipping date"}: {fmtDate(o.eta)}{o.etaReason ? `. ${o.etaReason}` : ""}</div>
      )}

      <div className="detail">
        <div>
          {/* ---- changes waiting for the dealer ---- */}
          {pending && (
            <section className="panel" style={{ borderColor: "var(--warn)" }}>
              <h3>{staff ? "Waiting for the dealer to approve changes" : "Please check these changes"}</h3>
              <p className="hint" style={{ margin: 0 }}>{pending.byName} changed this order {when(pending.createdAt)}.{pending.note ? ` "${pending.note}"` : ""}</p>
              <Diff diff={pending.diff} after={pending.lines} cur={cur} />
              {c("dealer_decide") && (
                <form action={A.approveAction}>
                  {hid}
                  <div className="fld"><label htmlFor="reply">Message (optional for approve)</label><textarea id="reply" name="reply" placeholder="e.g. That's grand, go ahead. Or: we still need the 106-link chains." /></div>
                  <div className="row">
                    <button className="btn ok big">Approve changes</button>
                    <button className="btn ghost" formAction={A.queryAction}>Send question back</button>
                  </div>
                </form>
              )}
              {c("withdraw_proposal") && <form action={A.withdrawAction} className="inline">{hid}<button className="btn ghost">Withdraw changes</button></form>}
            </section>
          )}
          {staff && failedPush && (
            <section className="panel" style={{ borderColor: "var(--danger)" }}>
              <h3>Website not updated</h3>
              <p className="hint" style={{ margin: 0 }}>The dealer approved the changes, but WooCommerce didn't accept them: {failedPush.push_error}</p>
              {v.role === "admin" && <form action={A.retryPushAction} className="inline">{hid}<input type="hidden" name="proposal" value={failedPush.id} /><button className="btn">Try again</button></form>}
            </section>
          )}

          {/* ---- the lines: view, edit or reorder ---- */}
          <section className="panel">
            <div className="bar">
              <h3>{editing ? "Edit order" : reordering ? "Reorder" : "Parts"}</h3>
              <div className="row">
                {!editing && !reordering && c("propose_edit") && <Link className="btn ghost" href={`/orders/${o.id}?edit=1`}>Edit order</Link>}
                {!editing && !reordering && (v.role === "dealer" || v.role === "admin") && <Link className="btn ghost" href={`/orders/${o.id}?reorder=1`}>Reorder</Link>}
                {(editing || reordering) && <Link className="btn ghost" href={`/orders/${o.id}`}>Cancel</Link>}
              </div>
            </div>
            {editing ? <EditForm id={o.id} lines={lines} cur={cur} /> : reordering ? <ReorderForm id={o.id} lines={lines} cur={cur} /> : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Part</th><th className="n">Qty</th><th className="n">Price</th><th className="n">Total</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}><td>{l.name}{l.sku && <span className="sku">{l.sku}</span>}</td><td className="n">{l.qty}</td><td className="n">{money(l.unitPriceCents, cur)}</td><td className="n">{money(l.totalCents, cur)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {o.taxCents > 0 && <tr><td colSpan={3} className="n">Tax</td><td className="n">{money(o.taxCents, cur)}</td></tr>}
                    <tr><td colSpan={3} className="n">Order total</td><td className="n">{money(o.totalCents, cur)}</td></tr>
                  </tfoot>
                </table>
              </div>
            )}
            {o.dealerNote && !editing && !reordering && <p className="hint" style={{ margin: 0 }}><b>Dealer&apos;s note:</b> {o.dealerNote}</p>}
          </section>

          {/* ---- parcels ---- */}
          {d.shipments.length > 0 && (
            <section className="panel">
              <h3>Shipping</h3>
              {d.shipments.map((s) => (
                <div key={s.id} className="ship">
                  <b>Parcel {s.seq}{s.final ? (s.seq > 1 ? " · last parcel" : "") : " · more to follow"}</b>
                  <span>{s.carrier} · {s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noreferrer">{s.tracking}</a> : s.tracking}</span>
                  {s.contents && <span className="muted">{s.contents}</span>}
                  <span className="muted">Sent {when(s.created_at)} by {s.by_name}{s.eta_s ? ` · estimated delivery ${fmtDate(s.eta_s)}` : ""}</span>
                </div>
              ))}
            </section>
          )}

          {/* ---- received ---- */}
          {o.stage === "received" && (
            <section className="panel">
              <h3>Received</h3>
              {o.receivedAuto ? <p className="hint" style={{ margin: 0 }}>Closed automatically on {day(o.receivedAt!)}. The dealer never pressed Received.</p> : (
                <p style={{ margin: 0 }}>
                  {o.receivedCondition === "ok" ? "Arrived in good condition" : o.receivedCondition === "damaged" ? "Damaged on arrival" : "Items missing"} · {day(o.receivedAt!)}
                  {o.receivedNote && <><br /><span className="muted">{o.receivedNote}</span></>}
                </p>
              )}
              {d.files.length > 0 && <div className="row">{d.files.map((f) => <a key={f.id} className="btn ghost" href={`/orders/files/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a>)}</div>}
            </section>
          )}

          {/* ---- messages ---- */}
          <section className="panel">
            <h3>Messages</h3>
            {d.messages.length === 0 && <p className="hint" style={{ margin: 0 }}>{staff ? "No messages yet. Messages here go to the dealer unless marked staff only." : "Questions about this order? Ask here and Tillotson will reply."}</p>}
            <div className="thread">
              {d.messages.map((m) => (
                <div key={m.id} className={"msg" + (m.author_id === v.id ? " mine" : "") + (m.internal ? " internal" : "")}>
                  <span className="by">{m.author_name ?? "Order Angel"}{m.author_role === "dealer" ? "" : m.author_role ? " · Tillotson" : ""} · {when(m.created_at)}{m.internal ? " · staff only" : ""}</span>
                  {m.body}
                </div>
              ))}
            </div>
            {c("message") && (
              <form action={A.messageAction}>
                {hid}
                <div className="fld"><label htmlFor="body">New message</label><textarea id="body" name="body" required maxLength={4000} /></div>
                <div className="row">
                  <button className="btn">Send</button>
                  {c("internal_message") && <label className="chk" style={{ fontSize: 15 }}><input type="checkbox" name="internal" value="yes" /> Staff only (not shown to the dealer)</label>}
                </div>
              </form>
            )}
          </section>

          {staff && d.activity.length > 0 && (
            <section className="panel">
              <details>
                <summary>History ({d.activity.length})</summary>
                <ul className="log">
                  {d.activity.map((a) => (
                    <li key={a.id}><time>{when(a.at)}</time>{ACTIVITY[a.action] ?? a.action}{a.actor_name ? ` · ${a.actor_name}` : a.action === "arrived" ? " · from the website" : ""}
                      {a.action === "website_update_failed" && a.detail?.error ? <span className="muted"> ({String(a.detail.error)})</span> : null}
                      {a.action === "delay_notice" && a.detail?.eta ? <span className="muted"> (to {fmtDate(String(a.detail.eta))})</span> : null}</li>
                  ))}
                </ul>
              </details>
            </section>
          )}
        </div>

        {/* ---- side: what happens next, and the details ---- */}
        <div>
          <section className="panel">
            <h3>Next step</h3>
            <NextStep stage={o.stage} role={v.role} pending={Boolean(pending)} reminders={o.lastReminderAt ? ago(o.lastReminderAt) : null} />
            {c("verify") && <form action={A.verifyAction}>{hid}<button className="btn ok big">Verify order</button><span className="hint">Prices and parts checked. Sends it to Shane and tells the dealer.</span></form>}
            {c("start") && <form action={A.startAction}>{hid}<button className="btn ok big">Start processing</button><span className="hint">Tells the dealer the order is in progress.</span></form>}
            {c("receive") && (
              <details open={v.role === "dealer"}>
                <summary>{v.role === "dealer" ? "Mark as received" : "Mark received for the dealer"}</summary>
                <form action={A.receiveAction} encType="multipart/form-data">
                  {hid}
                  <div className="radio" role="radiogroup" aria-label="How did it arrive?">
                    <label><input type="radio" name="condition" value="ok" defaultChecked /> All good</label>
                    <label><input type="radio" name="condition" value="damaged" /> Something is damaged</label>
                    <label><input type="radio" name="condition" value="missing" /> Something is missing</label>
                  </div>
                  <div className="fld"><label htmlFor="rnote">Note (needed if damaged or missing)</label><textarea id="rnote" name="note" /></div>
                  <div className="fld"><label htmlFor="photos">Photos (optional)</label><input id="photos" type="file" name="photos" accept="image/*,application/pdf" multiple /></div>
                  <button className="btn ok big">Received</button>
                </form>
              </details>
            )}
            {c("add_shipment") && (
              <details open={o.stage === "in_progress"}>
                <summary>Add shipping details</summary>
                <form action={A.shipmentAction}>
                  {hid}
                  <div className="two">
                    <div className="fld"><label htmlFor="carrier">Carrier</label><input id="carrier" name="carrier" required placeholder="DPD, UPS…" /></div>
                    <div className="fld"><label htmlFor="tracking">Tracking number</label><input id="tracking" name="tracking" required /></div>
                  </div>
                  <div className="fld"><label htmlFor="turl">Tracking link (optional)</label><input id="turl" name="tracking_url" type="url" placeholder="https://" /></div>
                  <div className="fld"><label htmlFor="seta">Estimated delivery (optional)</label><input id="seta" name="eta" type="date" /></div>
                  <div className="radio" role="radiogroup" aria-label="Is this everything?">
                    <label><input type="radio" name="final" value="yes" defaultChecked /> This is everything: order shipped</label>
                    <label><input type="radio" name="final" value="no" /> Part of the order: more parcels to follow</label>
                  </div>
                  <div className="fld"><label htmlFor="contents">What&apos;s in this parcel (needed if split)</label><input id="contents" name="contents" placeholder="e.g. Parcel 1 of 2: engines. Frames follow." /></div>
                  <button className="btn ok">Save and notify</button>
                </form>
              </details>
            )}
            {c("raise_issue") && v.role === "factory" && (
              <details>
                <summary>Report a problem to Mark and Andrew</summary>
                <form action={A.issueAction}>{hid}<div className="fld"><label htmlFor="ibody">What&apos;s the problem?</label><textarea id="ibody" name="body" required placeholder="e.g. Clutch drums out of stock until the 20th" /></div><button className="btn">Send to Mark and Andrew</button></form>
              </details>
            )}
            {c("delay_notice") && (
              <details open={openIssues.some((i) => i.kind === "factory")}>
                <summary>Tell the dealer about a delay</summary>
                <form action={A.delayAction}>
                  {hid}
                  <div className="fld"><label htmlFor="reason">Reason</label><textarea id="reason" name="reason" required placeholder="e.g. Clutch drums arrive from the supplier on the 20th." /></div>
                  <div className="fld"><label htmlFor="eta">New estimated shipping date</label><input id="eta" name="eta" type="date" required min={new Date().toISOString().slice(0, 10)} /></div>
                  <button className="btn">Send delay notice</button>
                  <span className="hint">The overdue flag waits until this date.</span>
                </form>
              </details>
            )}
            {c("cancel") && (
              <details>
                <summary>Cancel order</summary>
                <form action={A.cancelAction}>{hid}<div className="fld"><label htmlFor="creason">Reason</label><input id="creason" name="reason" required placeholder="e.g. Dealer phoned to cancel" /></div><button className="btn warn">Cancel this order</button></form>
              </details>
            )}
          </section>

          {staff && openIssues.length > 0 && (
            <section className="panel" style={{ borderColor: "var(--warn)" }}>
              <h3>Problems</h3>
              {openIssues.map((i) => (
                <div key={i.id} className="ship">
                  <b>{i.kind === "received" ? "Reported by the dealer" : `From ${i.by_name}`} · {when(i.raised_at)}</b>
                  <span>{i.body}</span>
                  {v.role === "admin" && (
                    <form action={A.resolveAction} className="inline">{hid}<input type="hidden" name="issue" value={i.id} /><input name="resolution" placeholder="What was done (optional)" style={{ flex: 1, minHeight: 40, borderRadius: 8, border: "1.5px solid var(--line)", padding: "6px 9px", background: "var(--surface)" }} /><button className="btn ghost">Resolved</button></form>
                  )}
                </div>
              ))}
            </section>
          )}

          <section className="panel">
            <h3>Details</h3>
            <dl className="kv">
              {staff && <><dt>Dealer</dt><dd>{o.dealerName}{o.dealerRegion ? ` · ${o.dealerRegion}` : ""}{o.dealerNeedsSetup ? " (new: needs setting up)" : ""}</dd></>}
              <dt>Ordered</dt><dd>{when(o.orderedAt)}</dd>
              <dt>Stage</dt><dd>{STAGE_LABEL[o.stage]} since {when(o.stageSince)}</dd>
              <dt>Total</dt><dd>{money(o.totalCents, cur)}</dd>
              {o.wooOrderId && <><dt>Website</dt><dd>WooCommerce order {o.wooOrderId}</dd></>}
              {addr(o.shipping) && <><dt>Ship to</dt><dd>{addr(o.shipping)}</dd></>}
              {o.invoiceNumber && <><dt>Invoice</dt><dd>{o.invoiceNumber}{o.invoicedAt ? ` · ${day(o.invoicedAt)}` : ""}</dd></>}
            </dl>
            {c("invoice") && (
              <form action={A.invoiceAction} className="inline">
                {hid}
                <input name="invoice" defaultValue={o.invoiceNumber ?? ""} placeholder="Invoice number" aria-label="Invoice number" style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "1.5px solid var(--line)", padding: "8px 12px", background: "var(--surface)" }} />
                <button className="btn ghost">{o.invoiceNumber ? "Update" : "Mark invoiced"}</button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function NextStep({ stage, role, pending, reminders }: { stage: string; role: string; pending: boolean; reminders: string | null }) {
  const dealer = role === "dealer";
  const t: Record<string, string> = dealer ? {
    submitted: pending ? "Tillotson has suggested changes. Please approve them or send a question back." : "Tillotson is checking your order.",
    verified: "Verified. Waiting for the factory to start.", in_progress: "The factory is working on your order.",
    shipped: "On its way. Press Received when it arrives.", received: "All done. Thanks!", cancelled: "This order was cancelled.",
  } : {
    submitted: pending ? "Waiting for the dealer to approve the changes." : role === "admin" ? "Check prices and parts, then verify, or edit and send to the dealer." : "Waiting for Mark or Andrew to verify.",
    verified: role === "factory" ? "Verified and ready for you to start." : "Verified. Waiting for Shane to start.",
    in_progress: "In production / being packed. Add shipping details when it goes.",
    shipped: `Waiting for the dealer to press Received${reminders ? ` (last reminder ${reminders} ago)` : ""}.`,
    received: "Finished.", cancelled: "Cancelled.",
  };
  return <p className="hint" style={{ margin: 0 }}>{t[stage]}</p>;
}

function Diff({ diff, after, cur }: { diff: { removed: Line[]; added: Line[]; changed: { before: Line; after: Line }[]; unchanged: Line[] }; after: Line[]; cur: string }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Part</th><th className="n">Qty</th><th className="n">Price</th><th></th></tr></thead>
        <tbody>
          {diff.changed.map(({ before: b, after: a }) => (
            <tr key={"c" + a.wooItemId} className="changed"><td>{a.name}<span className="sku">{a.sku}</span></td>
              <td className="n">{a.qty !== b.qty && <span className="was">{b.qty}</span>}{a.qty}</td>
              <td className="n">{a.unitPriceCents !== b.unitPriceCents && <span className="was">{money(b.unitPriceCents, cur)}</span>}{money(a.unitPriceCents, cur)}</td><td>Changed</td></tr>
          ))}
          {diff.added.map((a, i) => <tr key={"a" + i} className="added"><td>{a.name}<span className="sku">{a.sku}</span></td><td className="n">{a.qty}</td><td className="n">{money(a.unitPriceCents, cur)}</td><td>Added</td></tr>)}
          {diff.removed.map((r) => <tr key={"r" + r.wooItemId} className="removed"><td>{r.name}<span className="sku">{r.sku}</span></td><td className="n">{r.qty}</td><td className="n">{money(r.unitPriceCents, cur)}</td><td>Removed</td></tr>)}
          {diff.unchanged.map((u) => <tr key={"u" + u.wooItemId}><td>{u.name}<span className="sku">{u.sku}</span></td><td className="n">{u.qty}</td><td className="n">{money(u.unitPriceCents, cur)}</td><td className="muted">No change</td></tr>)}
        </tbody>
        <tfoot><tr><td colSpan={2} className="n">New total before tax</td><td className="n">{money(linesTotal(after), cur)}</td><td></td></tr></tfoot>
      </table>
    </div>
  );
}

const cell = { padding: "6px 4px" };
function EditForm({ id, lines, cur }: { id: string; lines: (Line & { id: string })[]; cur: string }) {
  const blanks = 4;
  return (
    <form action={A.proposeAction} className="edit">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="keep" value="&edit=1" />
      <input type="hidden" name="rows" value={lines.length + blanks} />
      <p className="hint" style={{ margin: 0 }}>Change quantities or prices. Set a quantity to 0 to remove a line. To swap a part number, set the old one to 0 and add the new part below. Prices in {cur}, before tax.</p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Part</th><th className="n">Qty</th><th className="n">Price each</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td style={cell}>{l.name}<span className="sku">{l.sku}</span>
                  <input type="hidden" name={`item_${i}`} value={l.wooItemId ?? ""} /><input type="hidden" name={`product_${i}`} value={l.wooProductId ?? ""} />
                  <input type="hidden" name={`sku_${i}`} value={l.sku ?? ""} /><input type="hidden" name={`name_${i}`} value={l.name} /></td>
                <td className="n" style={cell}><input className="q" name={`qty_${i}`} type="number" min={0} max={9999} defaultValue={l.qty} aria-label={`Quantity of ${l.name}`} /></td>
                <td className="n" style={cell}><input className="p" name={`price_${i}`} inputMode="decimal" defaultValue={(l.unitPriceCents / 100).toFixed(2)} aria-label={`Price of ${l.name}`} /></td>
              </tr>
            ))}
            {Array.from({ length: blanks }, (_, k) => {
              const i = lines.length + k;
              return (
                <tr key={"new" + k}>
                  <td style={cell}><div className="newpart">
                    <input name={`sku_${i}`} placeholder="New part number" aria-label="New part number" />
                    <input name={`name_${i}`} placeholder="Name (optional)" aria-label="New part name" />
                  </div></td>
                  <td className="n" style={cell}><input className="q" name={`qty_${i}`} type="number" min={0} max={9999} placeholder="0" aria-label="New part quantity" /></td>
                  <td className="n" style={cell}><input className="p" name={`price_${i}`} inputMode="decimal" placeholder="From website" aria-label="New part price" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="fld"><label htmlFor="enote">Note to the dealer</label><textarea id="enote" name="note" placeholder="e.g. Part 1234 is replaced by 1234-B; same price." /></div>
      <button className="btn big">Send to dealer for approval</button>
      <span className="hint">The dealer approves before anything changes on the website.</span>
    </form>
  );
}

function ReorderForm({ id, lines, cur }: { id: string; lines: (Line & { id: string })[]; cur: string }) {
  return (
    <form action={A.reorderAction} className="edit">
      <input type="hidden" name="id" value={id} />
      <p className="hint" style={{ margin: 0 }}>A new order with the same parts. Change the quantities you need; 0 leaves a part out. Prices are confirmed when Tillotson verifies it.</p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Part</th><th className="n">Last price</th><th className="n">Qty</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}><td style={cell}>{l.name}<span className="sku">{l.sku}</span></td><td className="n" style={cell}>{money(l.unitPriceCents, cur)}</td>
                <td className="n" style={cell}><input className="q" name={`rq_${l.id}`} type="number" min={0} max={9999} defaultValue={l.qty} aria-label={`Quantity of ${l.name}`} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn big">Submit reorder</button>
    </form>
  );
}
