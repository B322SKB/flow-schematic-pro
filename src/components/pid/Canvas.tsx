import { useEffect, useId, useRef, useState } from "react";
import { circuitColor } from "@/lib/pid/catalog";
import { pipeCrossings, pipeRoute, portPos } from "@/lib/pid/hydraulics";
import { usePid } from "@/lib/pid/store";
import { getSymbol } from "@/lib/pid/symbols";
import type { Pipe, PidNode, Scheme } from "@/lib/pid/types";
import { ZoomIn, ZoomOut, Maximize, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "node"; id: string; ox: number; oy: number }
  | { kind: "box"; x0: number; y0: number }
  | { kind: "code"; id: string; x0: number; y0: number; dx0: number; dy0: number }
  | null;

/** DN efectiv al unui element: setat manual sau preluat de la conducta conectată. */
export function nodeDn(n: PidNode, scheme: Scheme) {
  return n.dn ?? scheme.pipes.find((p) => p.from.node === n.id || p.to.node === n.id)?.dn;
}

export function PidCanvas({ svgRef: outerRef, readOnly = false, showTags = false }: {
  svgRef?: React.RefObject<SVGSVGElement | null>; readOnly?: boolean; showTags?: boolean;
}) {
  const { scheme, selected, multi, grid, select, setMulti, updateNode, moveNodes, addPipe, addNode, removeSelected, duplicateNodes } = usePid();
  const innerRef = useRef<SVGSVGElement>(null);
  const svgRef = outerRef ?? innerRef;
  const pid = useId().replace(/:/g, "");
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
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      const st = usePid.getState();
      const ids = st.multi.length ? st.multi : st.selected?.kind === "node" ? [st.selected.id] : [];
      if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      if (e.key === "Escape") { setPending(null); select(null); }
      if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey) && ids.length) { e.preventDefault(); duplicateNodes(ids); }
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && st.selected?.kind === "node") {
        const n = st.scheme.nodes.find((x) => x.id === st.selected!.id);
        if (n) updateNode(n.id, { rotation: (n.rotation + 90) % 360 });
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const a = arrows[e.key];
      if (a && ids.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        moveNodes(ids, a[0] * step, a[1] * step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, removeSelected, select, updateNode, moveNodes, duplicateNodes]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(4, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef]);

  const usedPorts = new Set(scheme.pipes.flatMap((p) => [`${p.from.node}:${p.from.port}`, `${p.to.node}:${p.to.port}`]));

  const onMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    setMouse(w);
    if (!drag) return;
    moved.current = true;
    if (drag.kind === "pan") setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    if (drag.kind === "code") updateNode(drag.id, { codeDx: Math.round(drag.dx0 + w.x - drag.x0), codeDy: Math.round(drag.dy0 + w.y - drag.y0) });
    if (drag.kind === "node") {
      const n = scheme.nodes.find((x) => x.id === drag.id);
      if (!n) return;
      let nx = Math.round((w.x - drag.ox) / grid) * grid;
      let ny = Math.round((w.y - drag.oy) / grid) * grid;
      // aliniere magnetică cu porturile conectate → trasee drepte, fără coturi inutile
      for (const p of scheme.pipes) {
        const mine = p.from.node === n.id ? p.from : p.to.node === n.id ? p.to : null;
        if (!mine) continue;
        const other = mine === p.from ? p.to : p.from;
        if (other.node === n.id) continue;
        const mp = portPos(scheme, n.id, mine.port), op = portPos(scheme, other.node, other.port);
        if (!mp || !op) continue;
        const offX = mp.x - n.x, offY = mp.y - n.y;
        if (Math.abs(ny + offY - op.y) < 8) ny = op.y - offY;
        if (Math.abs(nx + offX - op.x) < 8) nx = op.x - offX;
      }
      const dx = nx - n.x, dy = ny - n.y;
      if (!dx && !dy) return;
      if (multi.length > 1 && multi.includes(n.id)) moveNodes(multi, dx, dy);
      else updateNode(n.id, { x: nx, y: ny });
    }
  };

  const onUp = () => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "box" && moved.current) {
      const x1 = Math.min(d.x0, mouse.x), x2 = Math.max(d.x0, mouse.x), y1 = Math.min(d.y0, mouse.y), y2 = Math.max(d.y0, mouse.y);
      const ids = scheme.nodes.filter((n) => n.x >= x1 && n.x <= x2 && n.y >= y1 && n.y <= y2).map((n) => n.id);
      setMulti(ids);
      usePid.setState({ selected: ids[0] ? { kind: "node", id: ids[0] } : null });
    }
    if (d.kind === "node" && moved.current) snapDirect(d.id);
  };

  /** Dacă un port liber al elementului atinge un port liber vecin, le leagă direct (fără țeavă). */
  const snapDirect = (id: string) => {
    const st = usePid.getState();
    const s = st.scheme;
    const n = s.nodes.find((x) => x.id === id);
    if (!n) return;
    const used = new Set(s.pipes.flatMap((p) => [`${p.from.node}:${p.from.port}`, `${p.to.node}:${p.to.port}`]));
    for (const pt of getSymbol(n.type).ports) {
      if (used.has(`${n.id}:${pt.id}`)) continue;
      const a = portPos(s, n.id, pt.id);
      if (!a) continue;
      for (const o of s.nodes) {
        if (o.id === n.id) continue;
        for (const op of getSymbol(o.type).ports) {
          if (used.has(`${o.id}:${op.id}`)) continue;
          const b = portPos(s, o.id, op.id);
          if (!b || Math.hypot(a.x - b.x, a.y - b.y) > 12) continue;
          updateNode(n.id, { x: n.x + b.x - a.x, y: n.y + b.y - a.y });
          addPipe({ node: o.id, port: op.id }, { node: n.id, port: pt.id }, { direct: true });
          return;
        }
      }
    }
  };

  const onPortClick = (e: React.PointerEvent, node: string, port: string) => {
    e.stopPropagation();
    if (readOnly) return;
    if (!pending) setPending({ node, port });
    else {
      if (pending.node !== node || pending.port !== port) addPipe(pending, { node, port });
      setPending(null);
    }
  };

  const pendingPos = pending ? portPos(scheme, pending.node, pending.port) : null;
  const crossings = pipeCrossings(scheme);
  const multiSet = new Set(multi);

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
          if (e.shiftKey && !readOnly) { const w = toWorld(e.clientX, e.clientY); setDrag({ kind: "box", x0: w.x, y0: w.y }); return; }
          setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
        }}
        onClick={() => { if (!moved.current) { select(null); setPending(null); } }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (readOnly) return;
          const t = e.dataTransfer.getData("application/pid-symbol");
          if (!t) return;
          const w = toWorld(e.clientX, e.clientY);
          addNode(t, w.x, w.y);
        }}
      >
        <defs>
          <pattern id={`${pid}s`} width={10 * view.k} height={10 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <path d={`M ${10 * view.k} 0 L 0 0 0 ${10 * view.k}`} fill="none" stroke="var(--canvas-grid)" strokeWidth={0.5} />
          </pattern>
          <pattern id={`${pid}l`} width={100 * view.k} height={100 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <rect width="100%" height="100%" fill={`url(#${pid}s)`} />
            <path d={`M ${100 * view.k} 0 L 0 0 0 ${100 * view.k}`} fill="none" stroke="var(--canvas-grid)" strokeWidth={1.2} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${pid}l)`} />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <g id="pid-content">
            {scheme.pipes.map((p) => (
              <PipeView key={p.id} pipe={p} scheme={scheme} crossings={crossings} showTags={showTags}
                selected={selected?.kind === "pipe" && selected.id === p.id}
                onSelect={() => select({ kind: "pipe", id: p.id })} />
            ))}
            {scheme.nodes.map((n) => {
              const s = getSymbol(n.type);
              const isSel = (selected?.kind === "node" && selected.id === n.id) || multiSet.has(n.id);
              const openPorts = s.ports.filter((pt) => !usedPorts.has(`${n.id}:${pt.id}`)).length;
              const incomplete = s.ports.length > 1 && openPorts === s.ports.length;
              const dn = s.bomGroup === "Vane" ? nodeDn(n, scheme) : undefined;
              const codeText = s.code ? `${s.code}${dn ? ` DN${dn}` : ""}` : "";
              const cdx = n.codeDx ?? 0, cdy = n.codeDy ?? 0;
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y}) rotate(${n.rotation})`} opacity={n.redundant ? 0.6 : 1}>
                  <g
                    transform={`translate(${-s.w / 2},${-s.h / 2})`}
                    style={{ cursor: readOnly ? "default" : "move", color: isSel ? "var(--primary)" : undefined }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      moved.current = false;
                      if (readOnly) { select({ kind: "node", id: n.id }); return; }
                      const w = toWorld(e.clientX, e.clientY);
                      if (e.shiftKey) {
                        const st = usePid.getState();
                        const base = st.multi.length ? st.multi : st.selected?.kind === "node" ? [st.selected.id] : [];
                        const next = base.includes(n.id) ? base.filter((x) => x !== n.id) : [...base, n.id];
                        usePid.setState({ multi: next, selected: next.length ? { kind: "node", id: next[next.length - 1]! } : null });
                        return;
                      }
                      select({ kind: "node", id: n.id });
                      setDrag({ kind: "node", id: n.id, ox: w.x - n.x, oy: w.y - n.y });
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <rect x={-4} y={-4} width={s.w + 8} height={s.h + 8} fill="transparent"
                      stroke={isSel ? "var(--primary)" : "none"} strokeDasharray="4 3" strokeWidth={1} />
                    {s.render()}
                    {!readOnly && s.ports.map((pt) => {
                      const used = usedPorts.has(`${n.id}:${pt.id}`);
                      const act = pending?.node === n.id && pending.port === pt.id;
                      return (
                        <circle key={pt.id} cx={pt.x} cy={pt.y} r={act ? 5.5 : used ? 2.5 : 4}
                          fill={act ? "var(--primary)" : used ? "var(--canvas-ink)" : "var(--canvas-bg)"}
                          stroke="var(--primary)" strokeWidth={1.2} style={{ cursor: "crosshair" }} data-port="1"
                          onPointerDown={(e) => onPortClick(e, n.id, pt.id)} onClick={(e) => e.stopPropagation()}>
                          <title>Port {pt.id} – click pentru a trasa conductă</title>
                        </circle>
                      );
                    })}
                  </g>
                  <g transform={`rotate(${-n.rotation} 0 0)`}>
                    {showTags && (
                      <text x={0} y={s.h / 2 + 14} textAnchor="middle" fontSize={11} fontFamily="var(--app-mono)" fill="var(--primary)" pointerEvents="none">{n.tag}</text>
                    )}
                    {codeText && (
                      <text x={cdx} y={-s.h / 2 - 6 + cdy} textAnchor="middle" fontSize={10} fontWeight={700}
                        fontFamily="var(--app-mono)" fill="var(--canvas-ink)"
                        style={{ cursor: readOnly ? "default" : "grab" }}
                        pointerEvents={readOnly ? "none" : "all"}
                        onPointerDown={(e) => {
                          if (readOnly) return;
                          e.stopPropagation();
                          moved.current = false;
                          const w = toWorld(e.clientX, e.clientY);
                          select({ kind: "node", id: n.id });
                          setDrag({ kind: "code", id: n.id, x0: w.x, y0: w.y, dx0: cdx, dy0: cdy });
                        }}
                        onClick={(e) => e.stopPropagation()}>
                        <title>Trage pentru a muta eticheta</title>
                        {codeText}
                      </text>
                    )}
                    {s.hasVolume && !!n.volume && (
                      <text x={cdx} y={-s.h / 2 - 6 + cdy - 12} textAnchor="middle" fontSize={9} fontFamily="var(--app-mono)" fill="var(--canvas-ink)" opacity={0.7} pointerEvents="none">
                        V={n.volume} l
                      </text>
                    )}
                    {s.riser && (
                      <text x={0} y={s.h / 2 + (showTags ? 25 : 12)} textAnchor="middle" fontSize={9} fontFamily="var(--app-mono)"
                        fill="var(--canvas-ink)" opacity={0.75} pointerEvents="none">
                        {s.riser === "up" ? "▲ +" : "▼ −"}{Math.abs(n.z ?? 0)} m
                      </text>
                    )}
                    {(s.terminal || s.source) && n.redundant && (
                      <text x={0} y={s.h / 2 + (showTags ? 25 : 12)} textAnchor="middle" fontSize={9} fontFamily="var(--app-mono)" fill="var(--canvas-ink)" pointerEvents="none">REDUNDANT</text>
                    )}
                    {incomplete && !readOnly && <circle cx={s.w / 2 + 6} cy={-s.h / 2 - 6} r={3.5} fill="var(--destructive)" opacity={0.85} pointerEvents="none" />}
                  </g>
                </g>
              );
            })}
          </g>
          {pendingPos && (
            <path d={`M${pendingPos.x} ${pendingPos.y} H${mouse.x} V${mouse.y}`} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
          )}
          {drag?.kind === "box" && (
            <rect x={Math.min(drag.x0, mouse.x)} y={Math.min(drag.y0, mouse.y)} width={Math.abs(mouse.x - drag.x0)} height={Math.abs(mouse.y - drag.y0)}
              fill="var(--primary)" fillOpacity={0.08} stroke="var(--primary)" strokeDasharray="4 3" pointerEvents="none" />
          )}
        </g>
      </svg>
      {!readOnly && (
        <div className="absolute bottom-3 left-3 max-w-[70%] rounded-md border bg-card/90 px-3 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur">
          {pending ? "Click pe un alt port pentru a finaliza conducta · Esc anulează"
            : multi.length > 1 ? `${multi.length} elemente selectate · trage pentru mutare · Ctrl+D duplică · săgeți = mutare fină · Del șterge`
            : "Port → port = conductă · apropie porturile = legătură directă · Shift+trage = selecție grup · Ctrl+D duplică · săgeți = mutare fină · R rotire"}
        </div>
      )}
      <div className="absolute bottom-3 right-3 flex gap-1">
        <Button size="icon" variant="secondary" onClick={() => setView((v) => ({ ...v, k: Math.min(4, v.k * 1.2) }))}><ZoomIn className="h-4 w-4" /></Button>
        <Button size="icon" variant="secondary" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))}><ZoomOut className="h-4 w-4" /></Button>
        <Button size="icon" variant="secondary" onClick={() => setView({ x: -40, y: 80, k: 1 })}><Maximize className="h-4 w-4" /></Button>
      </div>
      {!readOnly && scheme.nodes.some((n) => { const s = getSymbol(n.type); return s.ports.length > 1 && !scheme.pipes.some((p) => p.from.node === n.id || p.to.node === n.id); }) && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-[11px] text-destructive backdrop-blur">
          <AlertTriangle className="h-3.5 w-3.5" /> Există elemente neconectate
        </div>
      )}
    </div>
  );
}

function PipeView({ pipe, scheme, crossings, selected, onSelect, showTags }: {
  pipe: Pipe; scheme: Scheme; crossings: { x: number; y: number; pipeId: string }[]; selected: boolean; onSelect: () => void; showTags: boolean;
}) {
  const pts = pipeRoute(pipe, scheme);
  if (pts.length < 2) return null;
  const color = circuitColor(scheme, pipe.circuit);
  const w = 2 + Math.min(4, pipe.dn / 70);

  if (pipe.direct) {
    const a = pts[0]!, b = pts[pts.length - 1]!;
    return (
      <g onPointerDown={(e) => { e.stopPropagation(); onSelect(); }} onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={w} />
        <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={selected ? 5 : 3} fill={selected ? "var(--primary)" : color} />
      </g>
    );
  }

  const mine = crossings.filter((c) => c.pipeId === pipe.id);
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i === 0) { d += `M${p.x} ${p.y}`; continue; }
    const a = pts[i - 1]!;
    const horiz = Math.abs(a.y - p.y) < 1;
    const jumps = horiz
      ? mine.filter((c) => Math.abs(c.y - a.y) < 1 && c.x > Math.min(a.x, p.x) && c.x < Math.max(a.x, p.x))
        .sort((m, n) => (p.x > a.x ? m.x - n.x : n.x - m.x))
      : [];
    for (const j of jumps) {
      const dir = p.x > a.x ? 1 : -1;
      d += ` L${j.x - 6 * dir} ${a.y} A6 6 0 0 ${dir > 0 ? 1 : 0} ${j.x + 6 * dir} ${a.y}`;
    }
    d += ` L${p.x} ${p.y}`;
  }

  let best = 0, bi = 1;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    if (L > best) { best = L; bi = i; }
  }
  const a = pts[bi - 1]!, b = pts[bi]!;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const horiz = Math.abs(b.y - a.y) < 1;
  return (
    <g onPointerDown={(e) => { e.stopPropagation(); onSelect(); }} onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}
      opacity={pipe.disabled ? 0.4 : 1}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
      {selected && <path d={d} fill="none" stroke="var(--primary)" strokeWidth={w + 5} strokeOpacity={0.35} />}
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinejoin="round" strokeDasharray={pipe.disabled ? "8 6" : undefined} />
      {best > 30 && <path d="M-7 -5 L5 0 L-7 5 Z" fill={color} transform={`translate(${mx},${my}) rotate(${ang})`} />}
      {best > 50 && (
        <g pointerEvents="none" fontFamily="var(--app-mono)">
          <text x={horiz ? mx : mx + 8} y={horiz ? my - 9 : my - 4} fontSize={10} fill={color} textAnchor={horiz ? "middle" : "start"}>
            {showTags ? `${pipe.tag} · DN${pipe.dn}` : `DN${pipe.dn}`}{pipe.disabled ? " · SCOS" : ""}
          </text>
          <text x={horiz ? mx : mx + 8} y={horiz ? my + 15 : my + 8} fontSize={8} fill="var(--canvas-ink)" opacity={0.45} textAnchor={horiz ? "middle" : "start"}>
            {pipe.length.toFixed(1)} m
          </text>
        </g>
      )}
    </g>
  );
}
