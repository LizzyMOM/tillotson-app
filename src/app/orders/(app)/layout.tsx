import "../orders.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentViewer } from "@/lib/orders/session";
import { counts } from "@/lib/orders/service";
import { signOutAction } from "../actions";
import { TomLogo } from "../ui";
import { SYSTEM_NAME } from "@/lib/orders/name";

export const metadata: Metadata = { title: SYSTEM_NAME };
export const dynamic = "force-dynamic";

const ROLE: Record<string, string> = { admin: "Admin", factory: "Factory", dealer: "Dealer" };

export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  const v = await currentViewer();
  if (!v) redirect("/orders/sign-in");
  const c = await counts(v);
  return (
    <main className="shell oa">
      <header className="top">
        <div className="topline">
          <Link href="/orders" className="ev brand">{/* TOM */}<TomLogo />{SYSTEM_NAME}</Link>
          <div className="who">
            <Link href="/orders/notifications" className="bell">Notifications{c.unread ? <b>{c.unread}</b> : null}</Link>
            <span>{v.name} · {v.role === "dealer" ? v.dealerName : ROLE[v.role]}</span>
            <form action={signOutAction}><button>Sign out</button></form>
          </div>
        </div>
      </header>
      <div className="stripe" />
      {children}
    </main>
  );
}
