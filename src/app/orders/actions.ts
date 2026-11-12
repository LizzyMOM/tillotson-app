"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentViewer, signInAs, signOut, devSignInAllowed, type Viewer } from "@/lib/orders/session";
import * as svc from "@/lib/orders/service";

// Order Angel · the buttons. Each one checks who is signed in, does the action (the service checks the rules),
// then comes back to the order with a short message.

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (id: string, kind: "ok" | "err", msg: string, extra = "") => `/orders/${id}?${kind}=${encodeURIComponent(msg)}${extra}`;

async function run(f: FormData, ok: string, fn: (v: Viewer, id: string) => Promise<unknown>) {
  const v = await currentViewer();
  if (!v) redirect("/orders/sign-in");
  const id = str(f, "id");
  let to: string;
  try {
    await fn(v, id);
    to = back(id, "ok", ok);
  } catch (e) {
    if (!(e instanceof svc.OrderError)) console.error("Order Angel action failed", e);
    to = back(id, "err", e instanceof svc.OrderError ? e.message : "Something went wrong. Please try again.", str(f, "keep"));
  }
  revalidatePath("/orders");
  redirect(to);
}

export async function verifyAction(f: FormData) { await run(f, "Verified. Shane and the dealer have been told.", (v, id) => svc.verify(v, id)); }
export async function startAction(f: FormData) { await run(f, "Marked in progress. The dealer has been told.", (v, id) => svc.start(v, id)); }
export async function withdrawAction(f: FormData) { await run(f, "Changes withdrawn.", (v, id) => svc.withdrawProposal(v, id)); }
export async function retryPushAction(f: FormData) { await run(f, "Sent to the website again.", (v) => svc.retryPush(v, str(f, "proposal"))); }

export async function proposeAction(f: FormData) {
  const rows: svc.EditRow[] = [];
  const n = Number(str(f, "rows")) || 0;
  for (let i = 0; i < Math.min(n, 200); i++) {
    const item = str(f, `item_${i}`), product = str(f, `product_${i}`);
    rows.push({
      wooItemId: item ? Number(item) : null, wooProductId: product ? Number(product) : null,
      sku: str(f, `sku_${i}`), name: str(f, `name_${i}`), qty: str(f, `qty_${i}`).trim() === "" ? 0 : Number(str(f, `qty_${i}`)), price: str(f, `price_${i}`),
    });
  }
  await run(f, "Sent to the dealer for approval.", (v, id) => svc.proposeEdit(v, id, rows, str(f, "note")));
}
export async function approveAction(f: FormData) { await run(f, "Thanks. The changes are approved.", (v, id) => svc.dealerDecide(v, id, "approve", str(f, "reply"))); }
export async function queryAction(f: FormData) { await run(f, "Your question has been sent to Tillotson.", (v, id) => svc.dealerDecide(v, id, "query", str(f, "reply"))); }
export async function issueAction(f: FormData) { await run(f, "Mark and Andrew have been told.", (v, id) => svc.raiseIssue(v, id, str(f, "body"))); }
export async function resolveAction(f: FormData) { await run(f, "Problem marked resolved.", (v) => svc.resolveIssue(v, str(f, "issue"), str(f, "resolution"))); }
export async function delayAction(f: FormData) { await run(f, "Delay notice sent to the dealer.", (v, id) => svc.delayNotice(v, id, str(f, "eta"), str(f, "reason"))); }
export async function shipmentAction(f: FormData) {
  const final = str(f, "final") === "yes";
  await run(f, final ? "Shipped. Mark, Andrew and the dealer have been told." : "Parcel added. The dealer has been told.", (v, id) =>
    svc.addShipment(v, id, { carrier: str(f, "carrier"), tracking: str(f, "tracking"), trackingUrl: str(f, "tracking_url"), contents: str(f, "contents"), eta: str(f, "eta"), final }));
}
export async function receiveAction(f: FormData) {
  const photos = f.getAll("photos").filter((x): x is File => x instanceof File);
  await run(f, "Thanks. The order is marked received.", (v, id) =>
    svc.receive(v, id, { condition: str(f, "condition") as "ok" | "damaged" | "missing", note: str(f, "note"), photos }));
}
export async function cancelAction(f: FormData) { await run(f, "Order cancelled. The dealer and Shane have been told.", (v, id) => svc.cancel(v, id, str(f, "reason"))); }
export async function invoiceAction(f: FormData) { await run(f, str(f, "invoice").trim() ? "Invoice number saved." : "Invoice number cleared.", (v, id) => svc.setInvoice(v, id, str(f, "invoice"))); }
export async function messageAction(f: FormData) { await run(f, "Message sent.", (v, id) => svc.postMessage(v, id, str(f, "body"), str(f, "internal") === "yes")); }

export async function reorderAction(f: FormData) {
  const v = await currentViewer();
  if (!v) redirect("/orders/sign-in");
  const id = str(f, "id");
  const qtys = new Map<string, number>();
  for (const [k, val] of f.entries()) if (k.startsWith("rq_") && String(val).trim()) qtys.set(k.slice(3), Number(val));
  let to: string;
  try {
    const newId = await svc.reorder(v, id, qtys);
    to = `/orders/${newId}?ok=${encodeURIComponent("Reorder submitted. Tillotson will verify it.")}`;
  } catch (e) {
    to = back(id, "err", e instanceof svc.OrderError ? e.message : "The reorder didn't go through. Please try again.", "&reorder=1");
    if (!(e instanceof svc.OrderError)) console.error(e);
  }
  revalidatePath("/orders");
  redirect(to);
}

export async function readAllAction() {
  const v = await currentViewer();
  if (v) await svc.markRead(v);
  redirect("/orders/notifications");
}
export async function signInAction(f: FormData) {
  if (!devSignInAllowed()) redirect("/orders/sign-in");
  await signInAs(str(f, "account"));
  redirect("/orders");
}
export async function signOutAction() {
  await signOut();
  redirect("/orders/sign-in");
}
