import { draftFromCookie, saveForm, submit } from "@/lib/registration";
import { checkoutUrl } from "@/lib/payments";
import { json, openEvent, regCookie } from "../_common";

/** Saves the final answers, checks everything on the server and starts payment. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const o = await openEvent(slug);
  if ("res" in o) return o.res;
  const cookie = await regCookie(slug);
  let draft = await draftFromCookie(o.ev, cookie);
  if (!draft) return json({ error: "Your registration has expired. Please start again." }, 401);
  const body = await req.json();
  await saveForm(draft.id, body.form ?? {});
  draft = (await draftFromCookie(o.ev, cookie))!;
  const res = await submit(o.ev, draft);
  if (!res.ok) return json({ errors: res.errors }, 422);
  const f = draft.form;
  const url = await checkoutUrl(o.ev, draft.id, res.totalCents, f.guardianEmail || f.email!, `${f.firstName} ${f.lastName}`);
  return json({ ok: true, url });
}
