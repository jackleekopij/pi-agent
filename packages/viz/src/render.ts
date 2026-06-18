import type { VizSpec, Theme } from "./types.js";
import { defaultTheme } from "./theme.js";
import { byKind } from "./registry.js";
import { escapeHtml } from "./util.js";

/** Render a spec to a self-contained HTML/SVG fragment (data values escaped). */
export function toFragment(spec: VizSpec, theme: Theme = defaultTheme): string {
  if (spec.kind === "dashboard") {
    const items = spec.items.map((s) => `<div style="min-width:0">${toFragment(s, theme)}</div>`).join("");
    const container =
      spec.layout === "grid"
        ? "display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px"
        : "display:flex;flex-direction:column;gap:14px";
    return `<div style="${container}">${items}</div>`;
  }
  const c = byKind[spec.kind];
  if (!c) return `<div>Unsupported visualization: ${escapeHtml(spec.kind)}</div>`;
  return c.toFragment(spec, theme);
}

/**
 * Wrap a fragment in a full, self-contained INTERACTIVE HTML document — for
 * iframes / ui:// MCP resources. Adds hover highlighting, a floating tooltip
 * driven by `data-tip` on chart elements, and a height reporter so the host can
 * size the iframe to its content.
 */
export function toHTML(spec: VizSpec, theme: Theme = defaultTheme): string {
  const style =
    `body{margin:0;padding:14px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:${theme.text};background:${theme.bg}}` +
    `svg{max-width:100%;height:auto;display:block}` +
    `.seg{cursor:pointer;transition:opacity .12s ease,filter .12s ease}` +
    `.seg:hover{opacity:.82;filter:brightness(1.07)}` +
    `table tbody tr{transition:background .1s ease}` +
    `table tbody tr:hover{background:${theme.lightGrey}}` +
    `#viz-tip{position:fixed;pointer-events:none;z-index:9;background:${theme.navy};color:#fff;` +
    `font:12px system-ui,sans-serif;padding:5px 8px;border-radius:7px;opacity:0;` +
    `transform:translate(-50%,calc(-100% - 10px));transition:opacity .1s ease;white-space:nowrap;` +
    `box-shadow:0 4px 14px rgba(0,0,0,.22)}`;
  const script =
    `(function(){var tip=document.getElementById('viz-tip');` +
    `document.addEventListener('mousemove',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');` +
    `if(t){tip.textContent=t.getAttribute('data-tip');tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';tip.style.opacity='1';}` +
    `else{tip.style.opacity='0';}});` +
    `function report(){try{parent.postMessage({type:'resize',payload:{height:Math.ceil(document.documentElement.scrollHeight)}},'*');}catch(e){}}` +
    `window.addEventListener('load',report);if(window.ResizeObserver){new ResizeObserver(report).observe(document.documentElement);}setTimeout(report,60);})();`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>${style}</style></head><body>${toFragment(spec, theme)}` +
    `<div id="viz-tip"></div><script>${script}</script></body></html>`
  );
}
