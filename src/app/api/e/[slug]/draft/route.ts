import { ZodError } from "zod";
import { createDraft, draftFromCookie, saveForm } from "@/lib/registration";
import { json, openEvent, regCookie, setRegCookie } from "../_common";

/** Saves the form as the driver goes, creating their draft on first save. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const o = await openEvent(slug);
  if ("res" in o) return o.res;
  let draft = await draftFromCookie(o.ev, await regCookie(slug));
  if (!draft) {
    const created = await createDraft(o.ev);
    await setRegCookie(slug, created.cookie);
    draft = { id: created.id, status: "draft", form: {}, docs: [] };
  }
  try {
    const body = await req.json();
    const form = await saveForm(draft.id, body.form ?? {});
    return json({ ok: true, form });
  } catch (e) {
    if (e instanceof ZodError) return json({ error: "Some answers weren't in the right format", issues: e.issues.map((i) => i.path.join(".")) }, 400);
    throw e;
  }
}
