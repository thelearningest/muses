import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(binding?: Parameters<typeof drizzle>[0]) {
  if (!binding) {
    throw new Error("A D1 database binding is required");
  }
  return drizzle(binding, { schema });
}
