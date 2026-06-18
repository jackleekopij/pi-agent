import type { VizComponent, VizSpec, BarDatum, LineSeries, KpiItem, Theme } from "../types.js";
import { escapeHtml, isNum, num, pick, pickArray, pickString, isPlainObject } from "../util.js";

const VALUE_KEYS = ["value", "y", "count", "amount", "total"];
const LABEL_KEYS = ["label", "name", "x", "category", "key"];

// ---------------------------------------------------------------------------
// bar
// ---------------------------------------------------------------------------
export const bar: VizComponent = {
  kind: "bar",
  match(data) {
    const arr = pickArray(data);
    if (!arr || !arr.length) return 0;
    if (arr.every(isNum)) return 4;
    if (arr.every((r) => Array.isArray(r) && r.length >= 2 && isNum(r[1]))) return 5;
    const ok = arr.every((r) => isPlainObject(r) && VALUE_KEYS.some((k) => isNum(r[k])));
    return ok ? 5 : 0;
  },
  toSpec(input) {
    const arr = pickArray(input) ?? [];
    const series: BarDatum[] = arr
      .map((row, i): BarDatum => {
        if (isNum(row)) return { label: String(i + 1), value: num(row) };
        if (Array.isArray(row)) return { label: String(row[0] ?? i + 1), value: num(row[1]) };
        const label = pickString(row, LABEL_KEYS) ?? String(i + 1);
        const value = num(pick(row, VALUE_KEYS));
        const color = pickString(row, ["color"]);
        return color ? { label, value, color } : { label, value };
      })
      .filter((d) => Number.isFinite(d.value));
    const title = pickString(input, ["title"]);
    return title ? { kind: "bar", title, series } : { kind: "bar", series };
  },
  toFragment(spec, theme) {
    const s = spec as Extract<VizSpec, { kind: "bar" }>;
    const data = s.series;
    if (!data.length) return noData(theme);
    const max = Math.max(...data.map((d) => d.value), 1);
    const width = 860, height = 360, m = { top: 40, right: 24, bottom: 72, left: 64 };
    const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    const gap = 10, barW = Math.max(12, (plotW - gap * (data.length - 1)) / data.length);
    const bars = data
      .map((d, i) => {
        const h = (d.value / max) * plotH;
        const x = m.left + i * (barW + gap);
        const y = m.top + plotH - h;
        const color = d.color || theme.palette[i % theme.palette.length];
        return (
          `<g><rect class="seg" data-tip="${escapeHtml(`${d.label}: ${d.value}`)}" x="${x}" y="${y}" width="${barW}" height="${h}" rx="7" fill="${color}"></rect>` +
          `<text x="${x + barW / 2}" y="${y - 7}" text-anchor="middle" fill="${theme.text}" font-size="12">${escapeHtml(d.value)}</text>` +
          `<text x="${x + barW / 2}" y="${height - 36}" text-anchor="end" transform="rotate(-35 ${x + barW / 2} ${height - 36})" fill="${theme.text}" font-size="12">${escapeHtml(d.label)}</text></g>`
        );
      })
      .join("");
    return (
      svgOpen(width, height, s.title ?? "Bar chart") +
      `<line x1="${m.left}" y1="${m.top + plotH}" x2="${width - m.right}" y2="${m.top + plotH}" stroke="${theme.border}"/>` +
      `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + plotH}" stroke="${theme.border}"/>` +
      `<text x="${m.left}" y="24" fill="${theme.text}" font-size="12">max ${escapeHtml(max)}</text>${bars}</svg>`
    );
  },
};

// ---------------------------------------------------------------------------
// line
// ---------------------------------------------------------------------------
export const line: VizComponent = {
  kind: "line",
  match(data) {
    if (isPlainObject(data) && Array.isArray(data.series)) {
      if ((data.series as unknown[]).every((x) => isPlainObject(x) && Array.isArray(x.points))) return 7;
    }
    const arr = pickArray(data);
    if (!arr || !arr.length) return 0;
    const ok = arr.every(
      (r) => isPlainObject(r) && isNum(pick(r, ["y", "value", "count"])) && pick(r, ["x", "t", "date", "time"]) != null,
    );
    if (!ok) return 0;
    const xs = arr.map((r) => pick(r, ["x", "t", "date", "time"]));
    const temporal = xs.some((x) => typeof x === "string" && !Number.isNaN(Date.parse(x)));
    return temporal ? 7 : 5;
  },
  toSpec(input) {
    let series: LineSeries[];
    if (isPlainObject(input) && Array.isArray(input.series) && input.series.every((x) => isPlainObject(x) && Array.isArray(x.points))) {
      series = (input.series as Record<string, unknown>[]).map((sObj, i) => ({
        name: pickString(sObj, ["name", "label"]) ?? `Series ${i + 1}`,
        points: (sObj.points as Record<string, unknown>[]).map((p, j) => ({
          x: (pick(p, ["x", "t", "date", "time"]) as string | number) ?? j + 1,
          y: num(pick(p, ["y", "value", "count"])),
        })),
      }));
    } else {
      const arr = pickArray(input) ?? [];
      const points = arr.map((r, i) => {
        if (isNum(r)) return { x: i + 1, y: num(r) };
        const x = pick(r, ["x", "t", "date", "time", "label"]) ?? i + 1;
        return { x: typeof x === "number" ? x : String(x), y: num(pick(r, ["y", "value", "count"])) };
      });
      series = [{ name: pickString(input, ["name", "title"]) ?? "Series 1", points }];
    }
    const title = pickString(input, ["title"]);
    return title ? { kind: "line", title, series } : { kind: "line", series };
  },
  toFragment(spec, theme) {
    const s = (spec as Extract<VizSpec, { kind: "line" }>).series.filter((x) => x.points.length);
    if (!s.length) return noData(theme);
    const width = 860, height = 360, m = { top: 36, right: 24, bottom: 56, left: 60 };
    const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    const n = Math.max(...s.map((x) => x.points.length));
    const ys = s.flatMap((x) => x.points.map((p) => p.y));
    const maxY = Math.max(...ys, 1), minY = Math.min(...ys, 0);
    const xAt = (i: number) => m.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const yAt = (v: number) => m.top + plotH - ((v - minY) / ((maxY - minY) || 1)) * plotH;
    const lines = s
      .map((ser, si) => {
        const color = theme.palette[si % theme.palette.length];
        const pts = ser.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(" ");
        const dots = ser.points
          .map((p, i) => `<circle class="seg" data-tip="${escapeHtml(`${ser.name} — ${p.x}: ${p.y}`)}" cx="${xAt(i)}" cy="${yAt(p.y)}" r="4" fill="${color}"/>`)
          .join("");
        return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>${dots}`;
      })
      .join("");
    const step = Math.max(1, Math.ceil(n / 8));
    const xlabels = s[0].points
      .map((p, i) => (i % step === 0 ? `<text x="${xAt(i)}" y="${height - 28}" text-anchor="middle" fill="${theme.text}" font-size="11">${escapeHtml(p.x)}</text>` : ""))
      .join("");
    const legend =
      s.length > 1
        ? s.map((ser, si) => `<text x="${m.left + si * 150}" y="20" fill="${theme.palette[si % theme.palette.length]}" font-size="12">■ ${escapeHtml(ser.name)}</text>`).join("")
        : "";
    return (
      svgOpen(width, height, (spec as { title?: string }).title ?? "Line chart") +
      `<line x1="${m.left}" y1="${m.top + plotH}" x2="${width - m.right}" y2="${m.top + plotH}" stroke="${theme.border}"/>` +
      `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + plotH}" stroke="${theme.border}"/>` +
      `<text x="${m.left}" y="${m.top - 6}" fill="${theme.text}" font-size="11">max ${escapeHtml(maxY)}</text>${legend}${lines}${xlabels}</svg>`
    );
  },
};

// ---------------------------------------------------------------------------
// kpi
// ---------------------------------------------------------------------------
export const kpi: VizComponent = {
  kind: "kpi",
  match(data) {
    if (isNum(data)) return 5;
    if (isPlainObject(data)) {
      if (["nodes", "edges", "steps", "participants", "records"].some((k) => k in data)) return 0;
      const vals = Object.entries(data).filter(([k]) => k !== "title").map(([, v]) => v);
      if (!vals.length) return 0;
      if (vals.some((v) => Array.isArray(v) || isPlainObject(v))) return 0;
      const share = vals.filter(isNum).length / vals.length;
      if (share >= 0.5) return 6;
    }
    return 0;
  },
  toSpec(input) {
    const items: KpiItem[] = [];
    if (isNum(input)) items.push({ label: "Value", value: num(input) });
    else if (Array.isArray(input)) {
      for (const r of input) {
        const value = pick(r, VALUE_KEYS);
        items.push({
          label: pickString(r, LABEL_KEYS) ?? "—",
          value: isNum(value) ? num(value) : String(value ?? ""),
          unit: pickString(r, ["unit"]),
          delta: isNum(pick(r, ["delta", "change"])) ? num(pick(r, ["delta", "change"])) : undefined,
        });
      }
    } else if (isPlainObject(input)) {
      for (const [k, v] of Object.entries(input)) {
        if (k === "title" || Array.isArray(v) || isPlainObject(v)) continue;
        items.push({ label: k, value: isNum(v) ? num(v) : String(v) });
      }
    }
    const title = pickString(input, ["title"]);
    return title ? { kind: "kpi", title, items } : { kind: "kpi", items };
  },
  toFragment(spec, theme) {
    const items = (spec as Extract<VizSpec, { kind: "kpi" }>).items;
    const cards = items
      .map((it, i) => {
        const color = theme.palette[i % theme.palette.length];
        const delta =
          it.delta != null
            ? `<div style="font-size:12px;margin-top:4px;color:${it.delta >= 0 ? theme.green : theme.red}">${it.delta >= 0 ? "▲" : "▼"} ${escapeHtml(Math.abs(it.delta))}</div>`
            : "";
        const unit = it.unit ? `<span style="font-size:13px;font-weight:600;color:${theme.muted}"> ${escapeHtml(it.unit)}</span>` : "";
        return (
          `<div style="flex:1 1 150px;min-width:150px;border:1px solid ${theme.border};border-left:4px solid ${color};border-radius:12px;padding:12px 14px;background:#fff">` +
          `<div style="font-size:12px;color:${theme.muted};text-transform:uppercase;letter-spacing:.06em">${escapeHtml(it.label)}</div>` +
          `<div style="font-size:26px;font-weight:800;color:${theme.navy};margin-top:4px">${escapeHtml(it.value)}${unit}</div>${delta}</div>`
        );
      })
      .join("");
    return `<div style="display:flex;flex-wrap:wrap;gap:12px;padding:6px">${cards}</div>`;
  },
};

// ---------------------------------------------------------------------------
// pie
// ---------------------------------------------------------------------------
export const pie: VizComponent = {
  kind: "pie",
  // Lower than bar: "parts of a whole" is rarely inferable from data alone, so
  // pie is mostly used explicitly (render_pie / hint). Still matches weakly.
  match(data) {
    const arr = pickArray(data);
    if (!arr || !arr.length) return 0;
    const ok = arr.every((r) => isPlainObject(r) && VALUE_KEYS.some((k) => isNum(r[k])));
    return ok ? 3 : 0;
  },
  toSpec(input) {
    const base = bar.toSpec(input) as Extract<VizSpec, { kind: "bar" }>;
    const out: Extract<VizSpec, { kind: "pie" }> = { kind: "pie", slices: base.series };
    return base.title ? { ...out, title: base.title } : out;
  },
  toFragment(spec, theme) {
    const s = (spec as Extract<VizSpec, { kind: "pie" }>).slices.filter((d) => d.value > 0);
    if (!s.length) return noData(theme);
    const total = s.reduce((a, d) => a + d.value, 0) || 1;
    const width = 560, height = 360, cx = 180, cy = 180, r = 130;
    let angle = -Math.PI / 2;
    const arcs = s
      .map((d, i) => {
        const color = d.color || theme.palette[i % theme.palette.length];
        const frac = d.value / total;
        const pct = Math.round(frac * 100);
        const tip = escapeHtml(`${d.label}: ${d.value} (${pct}%)`);
        if (s.length === 1) return `<circle class="seg" data-tip="${tip}" cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
        const a0 = angle, a1 = angle + frac * 2 * Math.PI;
        angle = a1;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        const large = frac > 0.5 ? 1 : 0;
        const mid = (a0 + a1) / 2;
        const lx = cx + r * 0.62 * Math.cos(mid), ly = cy + r * 0.62 * Math.sin(mid);
        const label = pct >= 6 ? `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="12" font-weight="700" pointer-events="none">${pct}%</text>` : "";
        return `<path class="seg" data-tip="${tip}" d="M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z" fill="${color}"/>${label}`;
      })
      .join("");
    const legend = s
      .map((d, i) => {
        const color = d.color || theme.palette[i % theme.palette.length];
        const y = 44 + i * 24;
        return `<g><rect x="380" y="${y - 11}" width="13" height="13" rx="3" fill="${color}"/>` +
          `<text x="400" y="${y}" fill="${theme.text}" font-size="13">${escapeHtml(d.label)} — ${escapeHtml(d.value)}</text></g>`;
      })
      .join("");
    return svgOpen(width, height, (spec as { title?: string }).title ?? "Pie chart") + `${arcs}${legend}</svg>`;
  },
};

// ---------------------------------------------------------------------------
// shared svg helpers
// ---------------------------------------------------------------------------
function svgOpen(w: number, h: number, label: string): string {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(label)}" style="width:100%;height:auto">`;
}
function noData(theme: Theme): string {
  return `<div style="padding:14px;color:${theme.muted}">No data to render.</div>`;
}
