import Link from "next/link";
import { currentViewer } from "@/lib/orders/session";
import { notifications } from "@/lib/orders/service";
import { readAllAction } from "../../actions";
import { when } from "../../ui";

export default async function Notifications() {
  const v = (await currentViewer())!;
  const list = await notifications(v);
  const unread = list.some((n) => !n.read_at);
  return (
    <div className="body">
      <div className="bar">
        <h1 style={{ fontSize: 30 }}>Notifications</h1>
        {unread && <form action={readAllAction}><button className="btn ghost">Mark all read</button></form>}
      </div>
      {list.length === 0 ? <div className="empty">Nothing yet. You&apos;ll be told here (and by email) when an order needs you.</div> : (
        <div className="list">
          {list.map((n) => {
            const inner = <><b>{n.title}</b><span>{n.body}</span><time>{when(n.created_at)}</time></>;
            return n.order_id
              ? <Link key={n.id} href={`/orders/${n.order_id}`} className={"notif" + (n.read_at ? "" : " unread")}>{inner}</Link>
              : <Link key={n.id} href="/orders?stage=flagged" className={"notif" + (n.read_at ? "" : " unread")}>{inner}</Link>;
          })}
        </div>
      )}
    </div>
  );
}
