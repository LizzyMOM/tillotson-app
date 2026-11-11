import "server-only";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

// Private file storage for licence uploads. Files are never public: officials see them
// through the app, which checks who is asking.
// 'local' keeps files in .uploads for development. The live app will use Supabase Storage
// (a private bucket); that adapter is added when the account exists.
const ROOT = path.join(process.cwd(), ".uploads");

export async function putFile(key: string, bytes: Uint8Array, _mime: string): Promise<void> {
  if ((process.env.STORAGE ?? "local") !== "local") throw new Error("Only local storage is set up so far");
  const full = safePath(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}
export async function getFile(key: string): Promise<Buffer> {
  return readFile(safePath(key));
}
function safePath(key: string) {
  const full = path.join(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Bad storage key");
  return full;
}
