import "../orders.css";
import { devSignInAllowed } from "@/lib/orders/session";
import { accountsForSignIn } from "@/lib/orders/service";
import { signInAction } from "../actions";
import { SYSTEM_NAME } from "@/lib/orders/name";

export const dynamic = "force-dynamic";

/** Local testing only: pick who to be. In production this is replaced by Tillotson ID. */
export default async function SignIn() {
  const allowed = devSignInAllowed();
  const people = allowed ? await accountsForSignIn() : [];
  return (
    <main className="shell oa">
      <header className="top"><div className="ev">{SYSTEM_NAME}</div><h1>Sign in</h1></header>
      <div className="stripe" />
      <div className="body">
        {!allowed ? (
          <div className="info"><b>Sign in with Tillotson ID</b>This opens from the Tillotson app once Tillotson ID is connected.</div>
        ) : (
          <>
            <div className="info warn"><b>Test sign-in</b>For trying the system locally. Pick who you want to be; Tillotson ID replaces this before it goes live.</div>
            <form action={signInAction} className="list">
              {people.map((p) => (
                <button key={p.id} name="account" value={p.id} className="btn ghost big" style={{ justifyContent: "space-between" }}>
                  <span>{p.name}</span><span className="muted">{p.role === "dealer" ? p.dealer_name : p.role === "admin" ? "Admin" : "Factory"}</span>
                </button>
              ))}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
