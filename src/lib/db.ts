import "server-only";
import postgres from "postgres";

// One shared connection pool per server process.
const g = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
export const sql =
  g.__sql ??
  postgres(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/eventapp", {
    max: 5,
    idle_timeout: 20,
    transform: { undefined: null },
  });
if (process.env.NODE_ENV !== "production") g.__sql = sql;
