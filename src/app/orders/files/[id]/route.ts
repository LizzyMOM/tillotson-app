import { sql } from "@/lib/db";
import { getFile } from "@/lib/storage";
import { currentViewer } from "@/lib/orders/session";

/** A photo added on an order. Only staff, or the dealer whose order it is, can open it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await currentViewer();
  if (!v || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [f] = await sql`select f.storage_key, f.filename, f.mime, o.dealer_id from oa_files f join oa_orders o on o.id = f.order_id where f.id = ${id}`;
  if (!f || (v.role === "dealer" && f.dealer_id !== v.dealerId)) return new Response("Not found", { status: 404 });
  const bytes = await getFile(f.storage_key);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="${f.filename.replace(/[^\w.\- ]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
