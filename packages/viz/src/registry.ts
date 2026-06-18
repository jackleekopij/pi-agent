import type { VizComponent } from "./types.js";
import { bar, line, pie, kpi } from "./components/charts.js";
import { network, sequence } from "./components/graph.js";
import { table, image, markdown } from "./components/basic.js";

/**
 * Order matters only for score ties: earlier wins. `line` precedes `bar` so
 * {x,y} series prefer a line; structural matchers (network/sequence/image)
 * score high enough to win regardless of position. `pie` scores low (explicit
 * use only).
 */
export const components: VizComponent[] = [network, sequence, image, line, bar, kpi, table, pie, markdown];

export const byKind: Record<string, VizComponent> = Object.fromEntries(components.map((c) => [c.kind, c]));
