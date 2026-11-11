import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Mail { to: string; subject: string; text: string }

/** Sends with Resend when RESEND_API_KEY is set; otherwise writes the email to .mail for testing. */
export async function sendMail(m: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
    return;
  }
  const dir = path.join(process.cwd(), ".mail");
  await mkdir(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${m.to.replace(/[^a-z0-9@.]/gi, "_")}.txt`;
  await writeFile(path.join(dir, name), `To: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n`);
}
