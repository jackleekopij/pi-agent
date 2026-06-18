/** Shared helpers for normalizing loose input and emitting safe markup. */

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>'"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]!,
  );
}

export function isNum(v: unknown): boolean {
  return v != null && v !== "" && Number.isFinite(Number(v));
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The first array we can find: the value itself, or a common container key. */
export function pickArray(d: unknown): unknown[] | null {
  if (Array.isArray(d)) return d;
  if (isPlainObject(d)) {
    for (const k of ["data", "values", "rows", "items", "records", "series"]) {
      if (Array.isArray(d[k])) return d[k] as unknown[];
    }
  }
  return null;
}

/** First defined value among the given keys of an object. */
export function pick(o: unknown, keys: string[]): unknown {
  if (!isPlainObject(o)) return undefined;
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}

export function pickString(o: unknown, keys: string[]): string | undefined {
  const v = pick(o, keys);
  return v == null ? undefined : String(v);
}

export function tryJson(s: string): unknown {
  const t = s.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export function isImageString(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s.trim()) || /^data:image\//i.test(s.trim());
}

export function truncate(s: unknown, max: number): string {
  const str = String(s);
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
