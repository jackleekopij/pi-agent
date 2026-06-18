#!/usr/bin/env python3
"""
Architecture diagram for the Pi framework / pi-harness.

Shows the two delivery paths from pi-core up to the clients:
  - pi-chat (pi-web-chat): embeds the Pi SDK in-process
  - pi-mcp  (pi-mcp-ui):   drives pi as an MCP server over a spawned
                           `pi --mode rpc` subprocess
both rendering visuals through the shared @pi-harness/viz library.

Run:  python3 docs/architecture.py   ->   docs/pi-architecture.png
"""
from pathlib import Path
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

# ---- Woodside-ish palette ---------------------------------------------------
NAVY = "#003369"
RED = "#D71638"
MIDBLUE = "#0071BC"
ORANGE = "#F58220"
GREEN = "#3C9A36"
PURPLE = "#75287B"
TEAL = "#147C8B"
GREY = "#4D4D4F"
INK = "#222222"

fig, ax = plt.subplots(figsize=(15, 11.5))
ax.set_xlim(0, 14)
ax.set_ylim(0, 11.4)
ax.axis("off")


def box(x, y, w, h, title, body, edge, fill, title_color=None):
    ax.add_patch(
        FancyBboxPatch(
            (x, y), w, h,
            boxstyle="round,pad=0.02,rounding_size=0.12",
            linewidth=2, edgecolor=edge, facecolor=fill, zorder=2,
        )
    )
    cx = x + w / 2
    ax.text(cx, y + h - 0.30, title, ha="center", va="center",
            fontsize=11.5, fontweight="bold",
            color=title_color or edge, zorder=3)
    if body:
        ax.text(cx, y + (h - 0.55) / 2 + 0.04, body, ha="center", va="center",
                fontsize=8.6, color=INK, zorder=3, linespacing=1.45)
    return {"cx": cx, "top": (cx, y + h), "bot": (cx, y),
            "left": (x, y + h / 2), "right": (x + w, y + h / 2),
            "x": x, "y": y, "w": w, "h": h}


def arrow(p1, p2, label="", color=GREY, style="-|>", dashed=False,
          rad=0.0, lx=0.0, ly=0.0, fs=8.2, lcolor=None):
    ax.add_patch(
        FancyArrowPatch(
            p1, p2, arrowstyle=style, mutation_scale=16,
            linewidth=1.8, color=color, zorder=1,
            linestyle="--" if dashed else "-",
            connectionstyle=f"arc3,rad={rad}",
            shrinkA=2, shrinkB=2,
        )
    )
    if label:
        mx, my = (p1[0] + p2[0]) / 2 + lx, (p1[1] + p2[1]) / 2 + ly
        ax.text(mx, my, label, ha="center", va="center", fontsize=fs,
                color=lcolor or color, zorder=4,
                bbox=dict(boxstyle="round,pad=0.25", fc="white",
                          ec="none", alpha=0.92))


# ---- title ------------------------------------------------------------------
ax.text(7, 11.05, "Pi framework architecture — pi-core → pi-chat / pi-mcp",
        ha="center", va="center", fontsize=17, fontweight="bold", color=NAVY)
ax.text(7, 10.62,
        "Two delivery paths to the same pi-core. pi-chat embeds the SDK in-process; "
        "pi-mcp drives pi over a spawned `pi --mode rpc` subprocess.\n"
        "In-process custom tools extend pi: @pi-harness/viz (rendering) and the Revit API 2026 doc tools.",
        ha="center", va="center", fontsize=9.5, color=GREY, linespacing=1.5)

# ---- clients ----------------------------------------------------------------
A = box(0.7, 8.75, 5.5, 1.45,
        "Browser tab(s) — pi-web-chat UI  (app.js)",
        "conversations · markdown · thinking panel\n"
        "viz iframes · file upload / drag-drop · dark mode",
        MIDBLUE, "#E6F0F7")
B = box(7.8, 8.75, 5.5, 1.45,
        "MCP Host  —  Claude Desktop  /  dev page",
        "renders ui:// widgets in a sandboxed iframe\n"
        "forwards app.callServerTool() over postMessage",
        MIDBLUE, "#E6F0F7")

# ---- harness apps -----------------------------------------------------------
C = box(0.7, 6.35, 5.5, 1.7,
        "pi-web-chat   (pi-chat)",
        "Express + WebSocket server (/ws)\n"
        "createAgentSession() — in-process SDK\n"
        "customTools: viz (visualize / render_*)\n"
        "         + Revit (revit_api_search/doc/lookup)\n"
        "set_cwd · read_file · uploads",
        RED, "#FBE3E8")
D = box(7.8, 6.35, 5.5, 1.7,
        "pi-mcp-ui   (pi-mcp)",
        "MCP server (stdio + StreamableHTTP)\n"
        "pi_* tools: pi_send · pi_events (poll)\n"
        "pi_open · viz_* -> ui://viz resources\n"
        "two UI tracks: apps / mcpui",
        NAVY, "#E2E9F1")

# ---- in-process custom tools (left: revit · centre: viz)  +  rpc subprocess --
R = box(0.4, 4.5, 3.0, 1.35,
        "Revit API tools",
        "in-process customTools\n"
        "revit_api_search\n"
        "revit_api_doc · revit_api_lookup\n"
        "search · fetch · strip · cache",
        TEAL, "#E3F1F3")
V = box(3.6, 4.55, 4.9, 1.25,
        "@pi-harness/viz   (shared)",
        "orchestrator visualize(data)\n"
        "bar·line·pie·kpi·table·network·sequence\n"
        "toHTML() interactive · toFragment()",
        ORANGE, "#FDEBD8")
P = box(8.8, 4.5, 4.05, 1.35,
        "pi --mode rpc   (subprocess)",
        "spawned by RpcClient\n"
        "JSON-RPC over stdio\n"
        "push AgentEvents -> pollable buffer",
        PURPLE, "#EFE3F3")

# ---- pi-core ----------------------------------------------------------------
E = box(2.5, 2.35, 10.35, 1.55,
        "pi-core  —  @earendil-works/pi-coding-agent  (SDK)",
        "AgentSession · ModelRegistry · AuthStorage · SessionManager\n"
        "built-in tools:  read · bash · edit · write\n"
        "streams AgentEvents:  message_update · tool_execution_* · agent_end",
        GREEN, "#E4F2E5")

# ---- external resources -----------------------------------------------------
RD = box(0.4, 0.5, 3.0, 1.3,
         "Revit API 2026 docs  (web)",
         "revitapidocs.com/2026\n"
         "+ CloudFront namespace index\n"
         "(gzip-aware · in-memory cache)",
         TEAL, "#EAF5F6")
F = box(3.65, 0.5, 4.2, 1.3,
        "LLM providers",
        "Anthropic · OpenAI (gpt-5.5 / codex) · Google\n(your ~/.pi/agent auth)",
        GREY, "#F2F2F3")
G = box(8.15, 0.5, 4.7, 1.3,
        "Working directory (CWD)",
        "project files\n.pi-web-chat-uploads/",
        GREY, "#F2F2F3")

# ---- flows ------------------------------------------------------------------
# clients <-> apps
arrow(A["bot"], C["top"], "WebSocket  /ws\nJSON events", color=MIDBLUE,
      style="<|-|>", lx=-0.15, fs=8.0)
arrow(B["bot"], D["top"], "MCP protocol\ntools/call · resources · ui://", color=MIDBLUE,
      style="<|-|>", lx=0.1, fs=8.0)

# pi-chat -> core (in-process); -> revit tools; -> viz
arrow((3.1, C["y"]), (3.3, E["y"] + E["h"]), "in-process\ncreateAgentSession()",
      color=RED, lx=-0.66, fs=8.0)
arrow((1.5, C["y"]), R["top"], "buildRevitTools()", color=TEAL,
      dashed=True, lx=-0.02, ly=0.0, fs=7.8)
arrow((4.9, C["y"]), V["top"], "buildVizTools()\ndetails.viz {spec, html}",
      color=ORANGE, dashed=True, rad=-0.05, lx=0.62, ly=0.05, fs=7.6)

# revit tools -> external docs (down the left margin, clear of pi-core)
arrow(R["bot"], RD["top"], "HTTPS fetch\n+ cache", color=TEAL,
      style="<|-|>", lx=-0.02, fs=7.8)

# pi-mcp -> rpc subprocess -> core; -> viz
arrow(D["bot"], P["top"], "PiBridge · RpcClient", color=NAVY, lx=1.05, fs=8.0)
arrow(P["bot"], (10.4, E["y"] + E["h"]), "spawn  pi --mode rpc", color=PURPLE,
      lx=1.2, fs=8.0)
arrow((D["x"] + 0.5, D["y"]), (V["cx"] + 0.9, V["top"][1]), "viz_* -> ui://viz\n(toHTML)",
      color=ORANGE, dashed=True, rad=0.0, lx=0.15, ly=0.30, fs=7.6)

# core -> providers / filesystem
arrow((5.0, E["y"]), F["top"], "provider API\n(stream tokens)", color=GREEN,
      lx=-0.5, fs=8.0)
arrow((10.2, E["y"]), G["top"], "read · bash\nedit · write", color=GREEN,
      style="<|-|>", lx=0.6, fs=8.0)

# ---- legend -----------------------------------------------------------------
ax.text(0.4, 0.12,
        "Solid = request / control flow      Dashed = tools registered on the session "
        "(viz rendering · Revit docs)",
        ha="left", va="center", fontsize=8.5, color=GREY, style="italic")

out = Path(__file__).resolve().parent / "pi-architecture.png"
fig.tight_layout()
fig.savefig(out, dpi=200, bbox_inches="tight", facecolor="white")
print(f"wrote {out}")
