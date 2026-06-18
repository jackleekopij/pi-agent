import type { VizSpec } from "./types.js";
import { components, byKind } from "./registry.js";
import { isImageString, tryJson, isPlainObject, pickArray } from "./util.js";

export interface VizHint {
  /** Force a specific component kind (bar|line|kpi|table|network|sequence|image|markdown). */
  kind?: string;
  title?: string;
}

/**
 * The orchestrator. Given a loose data structure, pick (and sometimes compose)
 * the best-fitting component(s) and return a normalized VizSpec.
 */
export function visualize(data: unknown, hint?: VizHint): VizSpec {
  if (hint?.kind && byKind[hint.kind]) return withTitle(byKind[hint.kind].toSpec(data), hint.title);

  // Strings: an image URL/data-uri, otherwise parse-then-recurse, else markdown.
  if (typeof data === "string") {
    if (isImageString(data)) return withTitle(byKind.image.toSpec(data), hint?.title);
    const parsed = tryJson(data);
    if (parsed !== undefined) return visualize(parsed, hint);
    return withTitle(byKind.markdown.toSpec(data), hint?.title);
  }

  const scored = components
    .map((c) => ({ c, score: c.match(data) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return withTitle(byKind.markdown.toSpec(data), hint?.title);

  const best = scored[0].c;
  const bestSpec = best.toSpec(data);

  // Composition: a chart whose source rows carry extra columns is paired with a
  // data table so nothing in the original data is lost.
  if ((best.kind === "bar" || best.kind === "line") && hasExtraColumns(data)) {
    return {
      kind: "dashboard",
      layout: "stack",
      ...(hint?.title ? { title: hint.title } : {}),
      items: [bestSpec, byKind.table.toSpec(data)],
    };
  }
  return withTitle(bestSpec, hint?.title);
}

function withTitle(spec: VizSpec, title?: string): VizSpec {
  return title ? ({ ...spec, title } as VizSpec) : spec;
}

function hasExtraColumns(data: unknown): boolean {
  const arr = pickArray(data);
  if (!arr || !arr.length) return false;
  const keys = new Set<string>();
  for (const r of arr) if (isPlainObject(r)) for (const k of Object.keys(r)) keys.add(k);
  return keys.size > 2;
}
