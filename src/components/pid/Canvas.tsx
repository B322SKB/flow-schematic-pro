import { useEffect, useRef, useState } from "react";
import { CIRCUITS } from "@/lib/pid/catalog";
import { pipeRoute, portPos } from "@/lib/pid/hydraulics";
import { usePid } from "@/lib/pid/store";
import { SYMBOLS, type SymbolType } from "@/lib/pid/symbols";
import type { Pipe } from "@/lib/pid/types";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "node"; id: string; ox: number; oy: number }
  | null;

export function PidCanvas() {
  const { scheme, selected, select, updateNode, addPipe, addNode, removeSelected, recalcLengths } = usePid();
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: -40, y: 80, k: 1 });
  const [drag, setDrag] = useState<Drag>(null);
  const [pending, setPending] = useState<{ node: string; port: string } | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const moved = useRef(false);

  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      if (e.key === "Escape") { setPending(null); select(null); }
      if ((e.key === "r" || e.key === "R") && selected?.kind === "node") {
        const n = usePid.getState().scheme.nodes.find((x) => x.id === selected.id);
        if (n) { updateNode(n.id, { rotation: (n.rotation + 90) % 360 }); recalcLengths(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, removeSelected, select, updateNode, recalcLengths]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(3, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    setMouse(w);
    if (!drag) return;
    moved.current = true;
    if (drag.kind === "pan") setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    if (drag.kind === "node") updateNode(drag.id, { x: Math.round((w.x - drag.ox) / 10) * 10, y: Math.round((w.y - drag.oy) / 10) * 10 });
  };
  const onUp = () => {
    if (drag?.kind === "node" && moved.current) recalcLengths();
    setDrag(null);
  };

  const onPortClick = (e: React.PointerEvent, node: string, port: string) => {
    e.stopPropagation();
    if (!pending) setPending({ node, port });
    else {
      if (pending.node !== node || pending.port !== port) addPipe(pending, { node, port });
      setPending(null);
    }
  };

  const usedPorts = new Set(scheme.pipes.flatMap((p) => [`${p.from.node}:${p.from.port}`, `${p.to.node}:${p.to.port}`]));
  const pendingPos = pending ? portPos(scheme, pending.node, pending.port) : null;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: "var(--canvas-bg)" }}>
      <svg
        ref={svgRef}
        className="h-full w-full select-none"
        style={{ color: "var(--canvas-ink)", cursor: drag?.kind === "pan" ? "grabbing" : pending ? "crosshair" : "default" }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerDown={(e) => {
          moved.current = false;
          setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
        }}
        onClick={() => { if (!moved.current) { select(null); setPending(null); } }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const t = e.dataTransfer.getData("application/pid-symbol") as SymbolType;
          if (!t || !SYMBOLS[t]) return;
          const w = toWorld(e.clientX, e.clientY);
          addNode(t, w.x, w.y);
        }}
      >
        <defs>
          <pattern id="g-s" width={10 * view.k} height={10 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <path d={`M ${10 * view.k} 0 L 0 0 0 ${10 * view.k}`} fill="none" stroke="var(--canvas-grid)" strokeWidth={0.5} />
          </pattern>
          <pattern id="g-l" width={100 * view.k} height={100 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <rect width="100%" height="100%" fill="url(#g-s)" />
            <path d={`M ${100 * view.k} 0 L 0 0 0 ${100 * view.k}`} fill="none" stroke="var(--canvas-grid)" strokeWidth={1.2} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#g-l)" />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {scheme.pipes.map((p) => (
            <PipeView key={p.id} pipe={p} selected={selected?.kind === "pipe" && selected.id === p.id}
              onSelect={() => select({ kind: "pipe", id: p.id })} />
          ))}
          {pendingPos && (
            <path d={`M${pendingPos.x} ${pendingPos.y} H${mouse.x} V${mouse.y}`} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
          )}
          {scheme.nodes.map((n) => {
            const s = SYMBOLS[n.type];
            const isSel = selected?.kind === "node" && selected.id === n.id;
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y}) rotate(${n.rotation})`}>
                <g
                  transform={`translate(${-s.w / 2},${-s.h / 2})`}
                  style={{ cursor: "move", color: isSel ? "var(--primary)" : undefined }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    moved.current = false;
                    const w = toWorld(e.clientX, e.clientY);
                    select({ kind: "node", id: n.id });
                    setDrag({ kind: "node", id: n.id, ox: w.x - n.x, oy: w.y - n.y });
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <rect x={-4} y={-4} width={s.w + 8} height={s.h + 8} fill="transparent"
                    stroke={isSel ? "var(--primary)" : "none"} strokeDasharray="4 3" strokeWidth={1} />
                  {s.render()}
                  {s.ports.map((pt) => {
                    const used = usedPorts.has(`${n.id}:${pt.id}`);
                    const act = pending?.node === n.id && pending.port === pt.id;
                    return (
                      <circle key={pt.id} cx={pt.x} cy={pt.y} r={act ? 6 : 4.5}
                        fill={act ? "var(--primary)" : used ? "var(--canvas-ink)" : "var(--canvas-bg)"}
                        stroke="var(--primary)" strokeWidth={1.5} style={{ cursor: "crosshair" }}
                        onPointerDown={(e) => onPortClick(e, n.id, pt.id)} onClick={(e) => e.stopPropagation()}>
                        <title>Port {pt.id} – click pentru a trasa conductă</title>
                      </circle>
                    );
                  })}
                </g>
                <text x={0} y={s.h / 2 + 14} textAnchor="middle" fontSize={11} fontFamily="var(--app-mono)"
                  fill="var(--primary)" transform={`rotate(${-n.rotation} 0 0)`} pointerEvents="none">{n.tag}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute bottom-3 left-3 rounded-md border bg-card/90 px-3 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur">
        {pending ? "Click pe un alt port pentru a finaliza conducta · Esc anulează" : "Trage simboluri din bibliotecă · click port → port = conductă · R rotire · Del ștergere · scroll = zoom"}
      </div>
      <div className="absolute bottom-3 right-3 flex gap-1">
        <Button size="icon" variant="secondary" onClick={() => setView((v) => ({ ...v, k: Math.min(3, v.k * 1.2) }))}><ZoomIn className="h-4 w-4" /></Button>
        <Button size="icon" variant="secondary" onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k / 1.2) }))}><ZoomOut className="h-4 w-4" /></Button>
        <Button size="icon" variant="secondary" onClick={() => setView({ x: -40, y: 80, k: 1 })}><Maximize className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function PipeView({ pipe, selected, onSelect }: { pipe: Pipe; selected: boolean; onSelect: () => void }) {
  const scheme = usePid((s) => s.scheme);
  const pts = pipeRoute(pipe, scheme);
  if (pts.length < 2) return null;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const color = CIRCUITS[pipe.circuit].color;
  const w = 2 + Math.min(4, pipe.dn / 70);
  // longest segment for arrow + label
  let best = 0, bi = 1;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (L > best) { best = L; bi = i; }
  }
  const a = pts[bi - 1], b = pts[bi];
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const horiz = Math.abs(b.y - a.y) < 1;
  return (
    <g onPointerDown={(e) => { e.stopPropagation(); onSelect(); }} onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
      {selected && <path d={d} fill="none" stroke="var(--primary)" strokeWidth={w + 5} strokeOpacity={0.35} />}
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinejoin="round" />
      {best > 30 && (
        <path d="M-7 -5 L5 0 L-7 5 Z" fill={color} transform={`translate(${mx},${my}) rotate(${ang})`} />
      )}
      {best > 60 && (
        <text x={horiz ? mx : mx + 8} y={horiz ? my - 8 : my} fontSize={10} fontFamily="var(--app-mono)" fill={color}
          textAnchor={horiz ? "middle" : "start"} pointerEvents="none">
          {pipe.tag}
        </text>
      )}
    </g>
  );
}
