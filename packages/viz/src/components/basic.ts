import type { VizComponent, VizSpec, TableColumn } from "../types.js";
import { escapeHtml, isNum, isPlainObject, pickArray, pickString, isImageString } from "../util.js";

// ---------------------------------------------------------------------------
// table
// ---------------------------------------------------------------------------
function isColumnsRows(data: unknown): data is { columns: unknown[]; rows: unknown[]; title?: string } {
  return isPlainObject(data) && Array.isArray(data.columns) && Array.isArray(data.rows);
}

export const table: VizComponent = {
  kind: "table",
  match(data) {
    // SQL/query result shape: { columns: [...], rows: [...] }
    if (isColumnsRows(data)) return 6;
    const arr = pickArray(data);
    if (!arr || !arr.length || !arr.every(isPlainObject)) return 0;
    const keys = new Set<string>();
    for (const r of arr) for (const k of Object.keys(r as object)) keys.add(k);
    if (keys.size < 2) return 0;
    return keys.size > 2 ? 5 : 4;
  },
  toSpec(input) {
    const title = pickString(input, ["title"]);
    const withTitle = (columns: TableColumn[], rows: Record<string, unknown>[]) =>
      title ? { kind: "table" as const, title, columns, rows } : { kind: "table" as const, columns, rows };

    // SQL/query result shape: columns + rows (rows may be arrays or objects).
    if (isColumnsRows(input)) {
      const cols = input.columns.map((c) =>
        typeof c === "string"
          ? { key: c, label: c }
          : { key: String((c as any).key ?? (c as any).name ?? (c as any).field), label: String((c as any).label ?? (c as any).name ?? (c as any).key ?? (c as any).field) },
      );
      const rows = input.rows.map((r) =>
        Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c.key, r[i]])) : (r as Record<string, unknown>),
      );
      const columns: TableColumn[] = cols.map((c) => ({
        ...c,
        align: rows.every((r) => r[c.key] == null || isNum(r[c.key])) ? "right" : "left",
      }));
      return withTitle(columns, rows);
    }

    const rows = (pickArray(input) ?? []).filter(isPlainObject) as Record<string, unknown>[];
    const keys: string[] = [];
    for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    const columns: TableColumn[] = keys.map((k) => ({
      key: k,
      label: k,
      align: rows.every((r) => r[k] == null || isNum(r[k])) ? "right" : "left",
    }));
    return withTitle(columns, rows);
  },
  toFragment(spec, theme) {
    const s = spec as Extract<VizSpec, { kind: "table" }>;
    const head = s.columns
      .map((c) => `<th style="text-align:${c.align ?? "left"};padding:8px 10px;border-bottom:2px solid ${theme.navy};color:${theme.navy};font-size:13px">${escapeHtml(c.label)}</th>`)
      .join("");
    const body = s.rows
      .map((r, ri) => {
        const cells = s.columns
          .map((c) => {
            const v = r[c.key];
            return `<td style="text-align:${c.align ?? "left"};padding:8px 10px;border-bottom:1px solid ${theme.border};font-size:13px">${escapeHtml(v == null ? "" : v)}</td>`;
          })
          .join("");
        return `<tr style="background:${ri % 2 ? "#FAFAFA" : "#fff"}">${cells}</tr>`;
      })
      .join("");
    return `<div style="overflow:auto;padding:4px"><table style="border-collapse:collapse;width:100%">${`<thead><tr>${head}</tr></thead>`}<tbody>${body}</tbody></table></div>`;
  },
};

// ---------------------------------------------------------------------------
// image
// ---------------------------------------------------------------------------
export const image: VizComponent = {
  kind: "image",
  match(data) {
    if (typeof data === "string" && isImageString(data)) return 8;
    if (isPlainObject(data)) {
      if (typeof data.src === "string") return 8;
      if (typeof data.url === "string" && isImageString(data.url)) return 8;
      if (typeof data.data === "string" && /^image\//.test(String(data.mimeType ?? ""))) return 8;
    }
    return 0;
  },
  toSpec(input) {
    let src = "";
    let alt: string | undefined;
    let caption: string | undefined;
    let title: string | undefined;
    if (typeof input === "string") src = input;
    else if (isPlainObject(input)) {
      if (typeof input.src === "string") src = input.src;
      else if (typeof input.url === "string") src = input.url;
      else if (typeof input.data === "string" && input.mimeType) src = `data:${String(input.mimeType)};base64,${input.data}`;
      alt = pickString(input, ["alt"]);
      caption = pickString(input, ["caption"]);
      title = pickString(input, ["title"]);
    }
    const spec: Extract<VizSpec, { kind: "image" }> = { kind: "image", src };
    if (alt) spec.alt = alt;
    if (caption) spec.caption = caption;
    if (title) spec.title = title;
    return spec;
  },
  toFragment(spec, theme) {
    const s = spec as Extract<VizSpec, { kind: "image" }>;
    const cap = s.caption ? `<div style="font-size:12px;color:${theme.muted};padding:6px 2px">${escapeHtml(s.caption)}</div>` : "";
    return `<div style="padding:6px"><img src="${escapeHtml(s.src)}" alt="${escapeHtml(s.alt ?? s.title ?? "image")}" style="max-width:100%;height:auto;border-radius:10px;border:1px solid ${theme.border}"/>${cap}</div>`;
  },
};

// ---------------------------------------------------------------------------
// markdown (fallback) — minimal preformatted rendering; rich markdown is a
// client concern, this keeps the fragment self-contained and safe.
// ---------------------------------------------------------------------------
export const markdown: VizComponent = {
  kind: "markdown",
  match(data) {
    return typeof data === "string" ? 2 : 0;
  },
  toSpec(input) {
    const text = typeof input === "string" ? input : "```json\n" + JSON.stringify(input, null, 2) + "\n```";
    return { kind: "markdown", text };
  },
  toFragment(spec, theme) {
    const s = spec as Extract<VizSpec, { kind: "markdown" }>;
    return `<div style="white-space:pre-wrap;line-height:1.5;padding:8px 10px;color:${theme.text}">${escapeHtml(s.text)}</div>`;
  },
};
