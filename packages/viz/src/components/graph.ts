import type { VizComponent, VizSpec, NetworkNode, NetworkEdge, SeqParticipant, SeqStep, Theme } from "../types.js";
import { escapeHtml, pick, pickString, isPlainObject, truncate } from "../util.js";

function firstArray(obj: unknown, keys: string[]): unknown[] | null {
  if (!isPlainObject(obj)) return null;
  for (const k of keys) if (Array.isArray(obj[k])) return obj[k] as unknown[];
  return null;
}

function getNodeId(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object") return String(value);
  const v = value as Record<string, unknown>;
  const id = v.id ?? v.key ?? v.assetId ?? v.uuid ?? v.code ?? v.name ?? v.label;
  return id == null ? undefined : String(id);
}

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------
export const network: VizComponent = {
  kind: "network",
  match(data) {
    if (!isPlainObject(data)) return 0;
    if (Array.isArray(data.nodes) && Array.isArray(data.edges)) return 9;
    for (const k of ["records", "relationships", "links", "connections"]) if (Array.isArray(data[k])) return 8;
    return 0;
  },
  toSpec(input) {
    const nodeById = new Map<string, NetworkNode>();
    const edges: NetworkEdge[] = [];
    const addNode = (value: unknown): string => {
      const id = getNodeId(value) ?? `node-${nodeById.size + 1}`;
      if (!nodeById.has(id)) {
        const label = (isPlainObject(value) && pickString(value, ["label", "name", "displayName", "title"])) || id;
        const group = isPlainObject(value) ? pickString(value, ["group", "type", "category", "class", "kind"]) : undefined;
        nodeById.set(id, group ? { id, label, group } : { id, label });
      }
      return id;
    };

    for (const node of firstArray(input, ["nodes", "vertices", "entities", "items"]) ?? []) addNode(node);
    for (const edge of firstArray(input, ["edges", "relationships", "links", "connections"]) ?? []) {
      const source = getNodeId(pick(edge, ["source", "from", "start", "src"]));
      const target = getNodeId(pick(edge, ["target", "to", "end", "dst"]));
      if (!source || !target) continue;
      addNode(source);
      addNode(target);
      edges.push({ source, target, label: pickString(edge, ["label", "type", "name", "predicate", "relationshipType"]) ?? "" });
    }
    for (const record of firstArray(input, ["records", "rows"]) ?? []) {
      const source = pick(record, ["source", "from", "start", "asset", "parent"]);
      const target = pick(record, ["target", "to", "end", "connectsTo", "child"]);
      if (!source || !target) continue;
      const sid = addNode(source);
      const tid = addNode(target);
      const rel = pick(record, ["relationship", "relation", "edge", "link"]);
      edges.push({
        source: sid,
        target: tid,
        label: pickString(rel, ["label", "type", "name", "predicate"]) ?? pickString(record, ["label", "type"]) ?? "",
      });
    }

    const nodes = [...nodeById.values()];
    const title = pickString(input, ["title"]);
    return title ? { kind: "network", title, nodes, edges } : { kind: "network", nodes, edges };
  },
  toFragment(spec, theme) {
    const s = spec as Extract<VizSpec, { kind: "network" }>;
    if (!s.nodes.length) return `<div style="padding:14px;color:${theme.muted}">No nodes to render.</div>`;
    const n = s.nodes.length;
    const W = Math.max(640, Math.min(1100, 360 + n * 70));
    const H = Math.max(440, Math.min(780, 300 + n * 46));
    const margin = 72;
    const r = 16;

    // Colour by group (with a legend); fall back to per-node palette.
    const groups = [...new Set(s.nodes.map((nd) => nd.group).filter(Boolean))] as string[];
    const groupColor = new Map(groups.map((g, i) => [g, theme.palette[i % theme.palette.length]]));
    const colorOf = (nd: NetworkNode, i: number) => (nd.group && groupColor.get(nd.group)) || theme.palette[i % theme.palette.length];

    // Force-directed layout (Fruchterman–Reingold). Deterministic: seeded on a
    // circle, no randomness — same input → same picture (and the smoke is stable).
    const idx = new Map(s.nodes.map((nd, i) => [nd.id, i]));
    const pos = s.nodes.map((_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return { x: W / 2 + Math.cos(a) * Math.min(W, H) * 0.3, y: H / 2 + Math.sin(a) * Math.min(W, H) * 0.3 };
    });
    const edges = s.edges
      .map((e) => ({ a: idx.get(e.source), b: idx.get(e.target), label: e.label }))
      .filter((e) => e.a != null && e.b != null) as { a: number; b: number; label?: string }[];
    const k = Math.sqrt(((W - margin * 2) * (H - margin * 2)) / n) * 0.85;
    let temp = W * 0.12;
    for (let it = 0; it < 320; it++) {
      const disp = pos.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const rep = (k * k) / dist, ux = dx / dist, uy = dy / dist;
          disp[i].x += ux * rep; disp[i].y += uy * rep;
          disp[j].x -= ux * rep; disp[j].y -= uy * rep;
        }
      }
      for (const e of edges) {
        let dx = pos[e.a].x - pos[e.b].x, dy = pos[e.a].y - pos[e.b].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const att = (dist * dist) / k, ux = dx / dist, uy = dy / dist;
        disp[e.a].x -= ux * att; disp[e.a].y -= uy * att;
        disp[e.b].x += ux * att; disp[e.b].y += uy * att;
      }
      for (let i = 0; i < n; i++) {
        disp[i].x += (W / 2 - pos[i].x) * 0.012;
        disp[i].y += (H / 2 - pos[i].y) * 0.012;
        const d = Math.hypot(disp[i].x, disp[i].y) || 0.01;
        pos[i].x += (disp[i].x / d) * Math.min(d, temp);
        pos[i].y += (disp[i].y / d) * Math.min(d, temp);
        pos[i].x = Math.max(margin, Math.min(W - margin, pos[i].x));
        pos[i].y = Math.max(margin, Math.min(H - margin, pos[i].y));
      }
      temp *= 0.985;
    }

    const halo = `paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round"`;
    const edgeSvg = edges
      .map((e, ei) => {
        const a = pos[e.a], b = pos[e.b];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const tip = escapeHtml(e.label || `${s.nodes[e.a].label} → ${s.nodes[e.b].label}`);
        const line = `<line class="net-edge" data-a="${e.a}" data-b="${e.b}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${theme.midBlue}" stroke-width="1.8" stroke-opacity="0.55"/>`;
        const hit = `<line class="seg net-edge-hit" data-a="${e.a}" data-b="${e.b}" data-tip="${tip}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="14"/>`;
        const lbl = e.label ? `<text class="net-edge-label" data-a="${e.a}" data-b="${e.b}" x="${mx}" y="${my - 5}" text-anchor="middle" fill="${theme.muted}" font-size="10.5" ${halo} pointer-events="none">${escapeHtml(truncate(e.label, 22))}</text>` : "";
        return `<g data-edge="${ei}">${line}${hit}${lbl}</g>`;
      })
      .join("");
    const nodeSvg = pos
      .map((p, i) => {
        const nd = s.nodes[i];
        const color = colorOf(nd, i);
        const tip = escapeHtml(nd.label + (nd.group ? ` · ${nd.group}` : ""));
        return (
          `<g class="seg net-node" data-node="${i}" data-tip="${tip}" transform="translate(${p.x} ${p.y})" style="cursor:grab;touch-action:none">` +
          `<circle r="${r}" fill="${color}" stroke="#fff" stroke-width="2"/>` +
          `<text y="${r + 13}" text-anchor="middle" fill="${theme.text}" font-size="12" font-weight="600" ${halo} pointer-events="none">${escapeHtml(truncate(nd.label, 22))}</text></g>`
        );
      })
      .join("");
    const legend = groups.length
      ? `<g>` +
        groups
          .map((g, i) => {
            const y = 18 + i * 18;
            return `<rect x="14" y="${y - 9}" width="11" height="11" rx="3" fill="${groupColor.get(g)}"/><text x="31" y="${y}" fill="${theme.text}" font-size="11">${escapeHtml(g)}</text>`;
          })
          .join("") +
        `</g>`
      : "";
    const positions = JSON.stringify(pos.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })));
    const dragScript = `<script>(function(){
      function bind(svg){
        if(!svg || svg.dataset.dragBound) return; svg.dataset.dragBound='1';
        var pos=${positions}; var drag=null;
        function point(evt){var p=svg.createSVGPoint(); p.x=evt.clientX; p.y=evt.clientY; return p.matrixTransform(svg.getScreenCTM().inverse());}
        function update(){
          svg.querySelectorAll('.net-node').forEach(function(g){var i=+g.dataset.node; g.setAttribute('transform','translate('+pos[i].x+' '+pos[i].y+')');});
          svg.querySelectorAll('.net-edge,.net-edge-hit').forEach(function(l){var a=pos[+l.dataset.a], b=pos[+l.dataset.b]; l.setAttribute('x1',a.x); l.setAttribute('y1',a.y); l.setAttribute('x2',b.x); l.setAttribute('y2',b.y);});
          svg.querySelectorAll('.net-edge-label').forEach(function(t){var a=pos[+t.dataset.a], b=pos[+t.dataset.b]; t.setAttribute('x',(a.x+b.x)/2); t.setAttribute('y',(a.y+b.y)/2-5);});
        }
        svg.addEventListener('pointerdown',function(evt){var g=evt.target.closest&&evt.target.closest('.net-node'); if(!g) return; var i=+g.dataset.node, p=point(evt); drag={i:i,dx:pos[i].x-p.x,dy:pos[i].y-p.y}; g.style.cursor='grabbing'; g.parentNode.appendChild(g); try{svg.setPointerCapture(evt.pointerId);}catch(e){} evt.preventDefault();});
        svg.addEventListener('pointermove',function(evt){if(!drag) return; var p=point(evt), i=drag.i; pos[i].x=Math.max(${margin},Math.min(${W - margin},p.x+drag.dx)); pos[i].y=Math.max(${margin},Math.min(${H - margin},p.y+drag.dy)); update(); evt.preventDefault();});
        function end(evt){ if(!drag) return; var g=svg.querySelector('.net-node[data-node="'+drag.i+'"]'); if(g) g.style.cursor='grab'; drag=null; }
        svg.addEventListener('pointerup',end); svg.addEventListener('pointercancel',end); svg.addEventListener('lostpointercapture',end);
        svg.addEventListener('dblclick',function(evt){var g=evt.target.closest&&evt.target.closest('.net-node'); if(!g) return; var label=(g.getAttribute('data-tip')||'node'); try{parent.postMessage({type:'notify',payload:{message:'Selected network node: '+label}},'*');}catch(e){} });
      }
      document.querySelectorAll('svg.viz-network').forEach(bind);
    })();</script>`;
    return `<svg class="viz-network" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(s.title ?? "Network graph")}" style="width:100%;height:auto;touch-action:none;user-select:none">${edgeSvg}${nodeSvg}${legend}</svg>${dragScript}`;
  },
};

// ---------------------------------------------------------------------------
// sequence
// ---------------------------------------------------------------------------
export const sequence: VizComponent = {
  kind: "sequence",
  match(data) {
    if (!isPlainObject(data)) return 0;
    const hasP = Array.isArray(data.participants) || Array.isArray(data.actors);
    const hasS = Array.isArray(data.steps) || Array.isArray(data.messages);
    if (hasP && hasS) return 9;
    if (hasS) return 6;
    return 0;
  },
  toSpec(input) {
    const rawP = (firstArray(input, ["participants", "actors"]) ?? []) as unknown[];
    const participants: SeqParticipant[] = rawP.map((p) =>
      typeof p === "string" ? { id: p, label: p } : { id: String(pick(p, ["id", "name", "label"])), label: String(pick(p, ["label", "name", "id"])) },
    );
    const steps: SeqStep[] = (firstArray(input, ["steps", "messages"]) ?? []).map((step, i) => ({
      from: String(pick(step, ["from", "source", "sender"]) ?? ""),
      to: String(pick(step, ["to", "target", "receiver"]) ?? ""),
      label: String(pick(step, ["label", "message", "text"]) ?? `Step ${i + 1}`),
      type: (pickString(step, ["type", "kind"]) as SeqStep["type"]) ?? "call",
    }));
    for (const step of steps) {
      for (const id of [step.from, step.to]) {
        if (id && !participants.some((p) => p.id === id)) participants.push({ id, label: id });
      }
    }
    const title = pickString(input, ["title"]);
    return title ? { kind: "sequence", title, participants, steps } : { kind: "sequence", participants, steps };
  },
  toFragment(spec, theme) {
    const s = spec as Extract<VizSpec, { kind: "sequence" }>;
    if (!s.participants.length || !s.steps.length) return `<div style="padding:14px;color:${theme.muted}">Sequence needs participants and steps.</div>`;
    const width = Math.max(860, s.participants.length * 170);
    const top = 70, rowH = 58, bottom = 60;
    const height = top + s.steps.length * rowH + bottom;
    const leftPad = 80, rightPad = 80;
    const gap = s.participants.length === 1 ? 0 : (width - leftPad - rightPad) / (s.participants.length - 1);
    const pos = new Map(s.participants.map((p, i) => [p.id, { ...p, x: leftPad + i * gap, color: theme.palette[i % theme.palette.length] }]));
    const heads = s.participants
      .map((p) => {
        const it = pos.get(p.id)!;
        return (
          `<g><rect x="${it.x - 58}" y="20" width="116" height="34" rx="8" fill="${it.color}"/>` +
          `<text x="${it.x}" y="42" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">${escapeHtml(p.label.slice(0, 18))}</text>` +
          `<line x1="${it.x}" y1="58" x2="${it.x}" y2="${height - 28}" stroke="${theme.border}" stroke-width="2" stroke-dasharray="6 7"/></g>`
        );
      })
      .join("");
    const arrows = s.steps
      .map((step, i) => {
        const a = pos.get(step.from), b = pos.get(step.to);
        if (!a || !b) return "";
        const y = top + i * rowH;
        const ret = step.type === "return" || step.type === "response";
        const color = ret ? theme.green : step.type === "error" ? theme.red : theme.navy;
        const dash = ret ? `stroke-dasharray="7 5"` : "";
        if (a.x === b.x) {
          return (
            `<g><path d="M ${a.x} ${y} C ${a.x + 70} ${y}, ${a.x + 70} ${y + 30}, ${a.x} ${y + 30}" fill="none" stroke="${color}" stroke-width="2" ${dash}/>` +
            `<polygon points="${a.x},${y + 30} ${a.x + 10},${y + 24} ${a.x + 10},${y + 36}" fill="${color}"/>` +
            `<text x="${a.x + 76}" y="${y + 18}" fill="${theme.text}" font-size="12">${escapeHtml(step.label)}</text></g>`
          );
        }
        const forward = b.x >= a.x;
        const arrow = forward
          ? `<polygon points="${b.x},${y} ${b.x - 10},${y - 6} ${b.x - 10},${y + 6}" fill="${color}"/>`
          : `<polygon points="${b.x},${y} ${b.x + 10},${y - 6} ${b.x + 10},${y + 6}" fill="${color}"/>`;
        const labelX = (a.x + b.x) / 2;
        const boxW = Math.min(360, Math.max(90, step.label.length * 7));
        return (
          `<g><line x1="${a.x}" y1="${y}" x2="${b.x}" y2="${y}" stroke="${color}" stroke-width="2" ${dash}/>${arrow}` +
          `<rect x="${labelX - boxW / 2}" y="${y - 25}" width="${boxW}" height="22" rx="5" fill="#fff" opacity=".92"/>` +
          `<text x="${labelX}" y="${y - 10}" text-anchor="middle" fill="${theme.text}" font-size="12">${escapeHtml(step.label.slice(0, 55))}</text></g>`
        );
      })
      .join("");
    return `<div style="overflow-x:auto"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(s.title ?? "Sequence diagram")}" style="min-width:${width}px;max-width:100%;height:auto">${heads}${arrows}</svg></div>`;
  },
};
