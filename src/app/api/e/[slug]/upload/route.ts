import { addDocument, draftFromCookie, MAX_UPLOAD } from "@/lib/registration";
import { json, openEvent, regCookie } from "../_common";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const o = await openEvent(slug);
  if ("res" in o) return o.res;
  const draft = await draftFromCookie(o.ev, await regCookie(slug));
  if (!draft) return json({ error: "Your registration has expired. Please start again." }, 401);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD + 100_000) return json({ error: "That file is over 10 MB. Choose a smaller photo or PDF." }, 413);
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return json({ error: "Choose a file to upload" }, 400);
  const r = await addDocument(o.ev, draft, String(fd.get("kind") ?? ""), file);
  if (r.error) return json({ error: r.error }, 400);
  const fresh = await draftFromCookie(o.ev, await regCookie(slug));
  return json({ ok: true, docs: fresh?.docs ?? [] });
}
