// Deterministic hash of a SitePlan payload for optimistic locking.
// Pure: stable across runs given the same `data`.
import { createHash } from "node:crypto";

/** Stable JSON stringify (sorted keys, deterministic for nested objects). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

export function hashSitePlan(data: unknown): string {
  return createHash("sha256").update(stableStringify(data)).digest("hex");
}
