import { authorised } from "../_auth";
import { dailyCheck } from "@/lib/orders/service";

/** Once a day: remind dealers to press Received, close unconfirmed orders, send Mark and Andrew the flagged list. */
export async function GET(req: Request) {
  if (!authorised(req)) return new Response("Unauthorised", { status: 401 });
  return Response.json(await dailyCheck());
}
