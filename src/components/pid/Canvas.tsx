import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { circuitColor, innerDiameterMm } from "@/lib/pid/catalog";
import { computePipe, fmtP, pipeCrossings, pipeRoute, portPos, velocityLimits } from "@/lib/pid/hydraulics";
import { fluidProps } from "@/lib/pid/fluids";
import { usePid } from "@/lib/pid/store";
import { getSymbol } from "@/lib/pid/symbols";
import type { Pipe, PidNode, Scheme } from "@/lib/pid/types";
import { ZoomIn, ZoomOut, Maximize, AlertTriangle, Flame, Ruler, Eraser, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { findSnapPort } from "@/lib/pid/connect";
import { LAYERS, nodeLocked, nodeVisible, pipeLocked, pipeVisible, layerState } from "@/lib/pid/layers";
import { solveNetwork } from "@/lib/pid/solver";
import { evaluateNetwork } from "@/lib/pid/network";
import { engineeringCheck, type CheckLevel } from "@/lib/pid/checks";
import type { VisualMode } from "@/lib/pid/store";

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "node"; id: string; ox: number; oy: number; sx: number; sy: number }
  | { kind: "box"; x0: number; y0: number }
  | { kind: "seg"; pipeId: string; i: number; pts: { x: number; y: number }[]; horiz: boolean; x0: number; y0: number }
  | { kind: "code"; id: string; x0: number; y0: number; dx0: number; dy0: number }
  | null;

/** DN efectiv al unui element: setat manual sau preluat de la conducta conectată. */
export function nodeDn(n: PidNode, scheme: Scheme) {
  return n.dn ?? scheme.pipes.find((p) => p.from.node === n.id || p.to.node === n.id)?.dn;
}

export function PidCanvas({ svgRef: outerRef, readOnly = false, showTags = false, hideCodes = false, critical, focus }: {
  svgRef?: React.RefObject<SVGSVGElement | null>; readOnly?: boolean; showTags?: boolean; hideCodes?: boolean;
  critical?: string[] | undefined; focus?: string | null | undefined;
}) {
  const criticalSet = useMemo(() => new Set(critical ?? []), [critical]);
  const { scheme, selected, multi, multiPipes, grid, cad, select, setMulti, setMultiPipes, updateNode, moveNodes, addPipe, addNode, updatePipe, insertOnPipe,
    addGuide, clearGuides, addPipeToEnd, insertNodeOnPipe, insertModule, toggleSelect, beginTx, endTx, connectPorts, smartConnectOpenEnd,
    visualMode: vmStore, setVisualMode, viewRequest, focusInspector, currentLayer, setCad } = usePid();
  const visualMode: VisualMode = readOnly ? "design" : vmStore;
  const heat = visualMode === "hydraulic";
  const innerRef = useRef<SVGSVGElement>(null);
  const svgRef = outerRef ?? innerRef;
  const pid = useId().replace(/:/g, "");
  const [view, setView] = useState({ x: -40, y: 80, k: 1 });
  const [drag, setDrag] = useState<Drag>(null);
  const [pending, setPending] = useState<{ node: string; port: string } | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  /** Încadrează întreg desenul în ecran (Zoom Extents). */
  const zoomExtents = useCallback((ids?: string[]) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pts: { x: number; y: number }[] = [];
    const st = usePid.getState().scheme;
    const wanted = ids && ids.length ? new Set(ids) : null;
    if (wanted) {
      for (const p of st.pipes) if (wanted.has(p.id)) pts.push(...pipeRoute(p, st));
      for (const n of st.nodes) if (wanted.has(n.id)) { const s = getSymbol(n.type); pts.push({ x: n.x - s.w / 2, y: n.y - s.h / 2 }, { x: n.x + s.w / 2, y: n.y + s.h / 2 }); }
    } else {
      for (const n of st.nodes) {
        const s = getSymbol(n.type);
        pts.push({ x: n.x - s.w, y: n.y - s.h }, { x: n.x + s.w, y: n.y + s.h });
      }
      for (const p of st.pipes) pts.push(...pipeRoute(p, st));
    }
    if (!pts.length) { setView({ x: -40, y: 80, k: 1 }); return; }
    const x1 = Math.min(...pts.map((p) => p.x)), x2 = Math.max(...pts.map((p) => p.x));
    const y1 = Math.min(...pts.map((p) => p.y)), y2 = Math.max(...pts.map((p) => p.y));
    const pad = wanted ? 160 : 60;
    const k = Math.min(4, Math.max(0.15, Math.min((r.width - pad) / Math.max(40, x2 - x1), (r.height - pad) / Math.max(40, y2 - y1))));
    setView({ k, x: r.width / 2 - ((x1 + x2) / 2) * k, y: r.height / 2 - ((y1 + y2) / 2) * k });
  }, [svgRef]);

  // click pe un rând din tabelul hidraulic → conducta este adusă în centrul ecranului
  useEffect(() => {
    if (!focus) return;
    zoomExtents([focus]);
  }, [focus, zoomExtents]);

  // cereri de vizualizare din Find / Command bar / Copilot (nu modifică modelul)
  useEffect(() => {
    if (readOnly || !viewRequest) return;
    if (viewRequest.kind === "fit") zoomExtents();
    else if (viewRequest.kind === "ids") zoomExtents(viewRequest.ids);
    else {
      const st = usePid.getState();
      const ids = [...st.multi, ...st.multiPipes, ...(st.selected ? [st.selected.id] : [])];
      zoomExtents(ids.length ? ids : undefined);
    }
  }, [viewRequest, readOnly, zoomExtents]);

  const fpV = useMemo(() => fluidProps(scheme.fluid, scheme.concentration, scheme.temperature), [scheme.fluid, scheme.concentration, scheme.temperature]);
  // suprapuneri vizuale – calculate din model, fără mutații
  const overlay = useMemo(() => {
    const pipeColor = new Map<string, string>();
    const nodeHalo = new Map<string, string>();
    let crit = new Set<string>();
    if (visualMode === "hydraulic") {
      const sol = solveNetwork(scheme, fpV);
      for (const [id, r] of sol.pipes) {
        const p = scheme.pipes.find((x) => x.id === id)!;
        const [lo, hi] = velocityLimits(p.dn, scheme);
        pipeColor.set(id, Math.abs(r.flowSigned) <= 0 ? "var(--muted-foreground)" : r.v > hi ? "var(--destructive)" : r.v < lo ? "var(--warning)" : "var(--success)");
      }
      for (const id of sol.unresolvedPipes) pipeColor.set(id, "var(--destructive)");
    } else if (visualMode === "critical") {
      const ev = evaluateNetwork(scheme, fpV);
      const path = ev.networkSolved && ev.solution.critical ? ev.solution.critical.pipes : ev.critical?.pipes ?? [];
      crit = new Set(path);
      const end = ev.networkSolved ? ev.solution.critical?.endTag : ev.critical?.endTag;
      for (const p of scheme.pipes) if (crit.has(p.id)) { nodeHalo.set(p.from.node, "var(--destructive)"); nodeHalo.set(p.to.node, "var(--destructive)"); }
      const endNode = scheme.nodes.find((n) => n.tag === end);
      if (endNode) nodeHalo.set(endNode.id, "var(--destructive)");
    } else if (visualMode === "check") {
      const sum = engineeringCheck(scheme, fpV);
      const col: Record<CheckLevel, string | undefined> = { ok: undefined, warning: "var(--warning)", incomplete: "var(--muted-foreground)", unresolved: "var(--destructive)" };
      for (const e of sum.elements) {
        const c = col[e.level];
        if (!c) continue;
        if (e.kind === "pipe") pipeColor.set(e.id, c); else nodeHalo.set(e.id, c);
      }
    }
    return { pipeColor, nodeHalo, crit };
  }, [visualMode, scheme, fpV]);

  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };

  // taste locale ale planșei (restul scurtăturilor sunt globale – vezi useGlobalShortcuts)
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const st = usePid.getState();
      const ids = st.multi.length ? st.multi : st.selected?.kind === "node" ? [st.selected.id] : [];
      if (e.key === "Escape") setPending(null);
      if ((e.key === "r" || e.key === "R") && st.selected?.kind === "node") {
        const n = st.scheme.nodes.find((x) => x.id === st.selected!.id);
        if (n) updateNode(n.id, { rotation: (n.rotation + 90) % 360 });
      }
      if ((e.key === "e" || e.key === "E") && !ids.length) { e.preventDefault(); zoomExtents(); }
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
  }, [readOnly, updateNode, moveNodes, zoomExtents]);

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
    const r = svgRef.current?.getBoundingClientRect();
    if (r) setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (!drag) return;
    moved.current = true;
    if (drag.kind === "pan") setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    if (drag.kind === "seg") {
      const P = drag.pts.map((p) => ({ ...p }));
      let i = drag.i;
      if (i - 1 === 0) { P.splice(1, 0, { ...P[0]! }); i++; }
      if (i === P.length - 1) { P.splice(i, 0, { ...P[i]! }); }
      const snap = (v: number) => Math.round(v / 5) * 5;
      if (drag.horiz) { const y = snap(drag.pts[drag.i]!.y + w.y - drag.y0); P[i - 1]!.y = y; P[i]!.y = y; }
      else { const x = snap(drag.pts[drag.i]!.x + w.x - drag.x0); P[i - 1]!.x = x; P[i]!.x = x; }
      updatePipe(drag.pipeId, { points: P.slice(1, -1) });
      return;
    }
    if (drag.kind === "code") updateNode(drag.id, { codeDx: Math.round(drag.dx0 + w.x - drag.x0), codeDy: Math.round(drag.dy0 + w.y - drag.y0) });
    if (drag.kind === "node") {
      const n = scheme.nodes.find((x) => x.id === drag.id);
      if (!n) return;
      let nx = Math.round((w.x - drag.ox) / grid) * grid;
      let ny = Math.round((w.y - drag.oy) / grid) * grid;
      // ORTHO: deplasarea rămâne pe o singură axă față de punctul de start
      if (cad.ortho) {
        const mx = Math.abs(w.x - drag.sx), my = Math.abs(w.y - drag.sy);
        if (mx >= my) ny = n.y; else nx = n.x;
      }
      if (cad.osnap) {
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
        // aliniere cu liniile ajutătoare
        for (const g of scheme.guides ?? []) {
          if (g.dir === "v" && Math.abs(nx - g.pos) < 6) nx = g.pos;
          if (g.dir === "h" && Math.abs(ny - g.pos) < 6) ny = g.pos;
        }
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
      // dreapta → stânga = fereastră „crossing" (prinde tot ce atinge caseta)
      const crossing = mouse.x < d.x0;
      const inBox = (x: number, y: number) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
      const ids = visNodes.filter((n) => {
        const s = getSymbol(n.type);
        if (crossing) {
          return !(n.x + s.w / 2 < x1 || n.x - s.w / 2 > x2 || n.y + s.h / 2 < y1 || n.y - s.h / 2 > y2);
        }
        return inBox(n.x - s.w / 2, n.y - s.h / 2) && inBox(n.x + s.w / 2, n.y + s.h / 2);
      }).map((n) => n.id);
      setMulti(ids);
      const pipeIds = visPipes.filter((p) => {
        if (p.direct) return false;
        const pts = pipeRoute(p, scheme);
        if (!pts.length) return false;
        if (crossing) return pts.some((q) => inBox(q.x, q.y)) || pts.every((q) => q.x >= x1 && q.x <= x2) || pts.every((q) => q.y >= y1 && q.y <= y2);
        return pts.every((q) => inBox(q.x, q.y));
      }).map((p) => p.id);
      setMultiPipes(pipeIds);
      usePid.setState({ selected: ids[0] ? { kind: "node", id: ids[0] } : pipeIds[0] ? { kind: "pipe", id: pipeIds[0] } : null });
    }
    if (d.kind === "node" && moved.current) {
      const st = usePid.getState();
      const n = st.scheme.nodes.find((x) => x.id === d.id);
      // Smart Connect: capătul liber al unei conducte lăsat peste un port liber se conectează
      const target = n?.type === "port_open" ? findSnapPort(st.scheme, { x: n.x, y: n.y }, 14, { node: n.id }) : null;
      if (n && target) {
        const r = smartConnectOpenEnd(n.id, target);
        if (!r.ok) toast.error(`Conexiune invalidă: ${r.reason}`);
      } else if (!snapDirect(d.id)) insertNodeOnPipe(d.id);
    }
    if (d.kind === "node" || d.kind === "seg" || d.kind === "code") endTx();
  };

  /** Dacă un port liber al elementului atinge un port liber vecin, le leagă direct (fără țeavă). */
  const snapDirect = (id: string): boolean => {
    const st = usePid.getState();
    const s = st.scheme;
    const n = s.nodes.find((x) => x.id === id);
    if (!n) return false;
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
          return true;
        }
      }
    }
    return false;
  };

  const onPortClick = (e: React.PointerEvent, node: string, port: string) => {
    e.stopPropagation();
    if (readOnly) return;
    if (!pending) setPending({ node, port });
    else {
      if (pending.node !== node || pending.port !== port) {
        // Smart Connect: validare + circuit propus din rolurile porturilor (Tur/Retur) sau din vecini
        const r = connectPorts(pending, { node, port });
        if (!r.ok) toast.error(`Conexiune invalidă: ${r.reason}`);
      }
      setPending(null);
    }
  };

  const pendingPos = pending ? portPos(scheme, pending.node, pending.port) : null;
  const snapTarget = pending && cad.osnap ? findSnapPort(scheme, mouse, 18 / view.k, { port: pending }) : null;
  const visNodes = scheme.nodes.filter((n) => nodeVisible(scheme, n));
  const visPipes = scheme.pipes.filter((p) => pipeVisible(scheme, p));
  const showGuides = layerState(scheme, "guides").visible;
  const crossings = pipeCrossings(scheme);
  const multiSet = new Set(multi);

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: "var(--canvas-bg)" }}>
      <svg
        ref={svgRef}
        className="h-full w-full select-none"
        style={{ color: "var(--canvas-ink)", cursor: drag?.kind === "pan" ? "grabbing" : readOnly ? "default" : "crosshair" }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { onUp(); setCursor(null); }}
        onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
        onPointerDown={(e) => {
          moved.current = false;
          // rotița mouse-ului = pan de oriunde; dublu-click pe rotiță = Zoom Extents
          if (e.button === 1) {
            e.preventDefault();
            if (e.detail >= 2) { zoomExtents(); return; }
            setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
            return;
          }
          if (e.button === 0 && !readOnly) { const w = toWorld(e.clientX, e.clientY); setDrag({ kind: "box", x0: w.x, y0: w.y }); return; }
          setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
        }}
        onClick={() => {
          if (moved.current) return;
          if (pending && !readOnly) {
            if (snapTarget) { const r = connectPorts(pending, snapTarget); if (!r.ok) toast.error(`Conexiune invalidă: ${r.reason}`); }
            else addPipeToEnd(pending, mouse.x, mouse.y);
            setPending(null); return;
          }
          select(null); setPending(null);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (readOnly) return;
          const mod = e.dataTransfer.getData("application/pid-module");
          if (mod) { const w = toWorld(e.clientX, e.clientY); insertModule(mod, w.x, w.y); return; }
          const t = e.dataTransfer.getData("application/pid-symbol");
          if (!t) return;
          const w = toWorld(e.clientX, e.clientY);
          // plasare peste o conductă existentă → elementul se inserează în traseu
          const sym = getSymbol(t);
          if (sym.ports.length >= 2) {
            let hit: string | null = null, hd = 14 / view.k;
            for (const p of scheme.pipes) {
              if (p.direct) continue;
              const pts = pipeRoute(p, scheme);
              for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1]!, b = pts[i]!;
                const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
                const tt = Math.max(0, Math.min(1, ((w.x - a.x) * (b.x - a.x) + (w.y - a.y) * (b.y - a.y)) / L2));
                const dd = Math.hypot(a.x + tt * (b.x - a.x) - w.x, a.y + tt * (b.y - a.y) - w.y);
                if (dd < hd) { hd = dd; hit = p.id; }
              }
            }
            if (hit && insertOnPipe(hit, t, w.x, w.y)) return;
          }
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
        {cad.showGrid !== false && <rect width="100%" height="100%" fill={`url(#${pid}l)`} />}
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <g id="pid-content">
            {visPipes.map((p) => (
              <PipeView key={p.id} pipe={p} scheme={scheme} crossings={crossings} showTags={showTags || visualMode === "mto"}
                selected={(selected?.kind === "pipe" && selected.id === p.id) || multiPipes.includes(p.id)}
                critical={criticalSet.has(p.id) || overlay.crit.has(p.id)}
                heat={heat}
                overlayColor={overlay.pipeColor.get(p.id)}
                onSelect={(e) => {
                  if (!readOnly && (e.ctrlKey || e.metaKey || e.shiftKey)) toggleSelect("pipe", p.id);
                  else select({ kind: "pipe", id: p.id });
                }}
                onDouble={() => { select({ kind: "pipe", id: p.id }); focusInspector(); }}
                onSegDown={readOnly || pipeLocked(scheme, p) ? undefined : (e, i, pts) => {
                  e.stopPropagation();
                  moved.current = false;
                  select({ kind: "pipe", id: p.id });
                  const w = toWorld(e.clientX, e.clientY);
                  beginTx(`Rerutare manuală ${p.tag}`);
                  setDrag({ kind: "seg", pipeId: p.id, i, pts, horiz: Math.abs(pts[i]!.y - pts[i - 1]!.y) < 1, x0: w.x, y0: w.y });
                }} />
            ))}
            {visNodes.map((n) => {
              const s = getSymbol(n.type);
              const locked = nodeLocked(scheme, n);
              const halo = overlay.nodeHalo.get(n.id);
              const isSel = (selected?.kind === "node" && selected.id === n.id) || multiSet.has(n.id);
              const openPorts = s.ports.filter((pt) => !usedPorts.has(`${n.id}:${pt.id}`)).length;
              const incomplete = s.ports.length > 1 && openPorts === s.ports.length;
              const dn = s.bomGroup === "Vane" ? nodeDn(n, scheme) : undefined;
              const codeText = hideCodes ? "" : s.code ? `${s.code}${dn ? ` DN${dn}` : ""}` : "";
              const cdx = n.codeDx ?? 0, cdy = n.codeDy ?? 0;
              return (
                <g key={n.id} data-layer="ELEMENTE" transform={`translate(${n.x},${n.y}) rotate(${n.rotation})`} opacity={n.redundant ? 0.6 : 1}>
                  <g
                    transform={`translate(${-s.w / 2},${-s.h / 2})`}
                    style={{ cursor: readOnly ? "default" : "move", color: isSel ? "var(--primary)" : undefined }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      moved.current = false;
                      if (readOnly) { select({ kind: "node", id: n.id }); return; }
                      const w = toWorld(e.clientX, e.clientY);
                      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelect("node", n.id); return; }
                      const st = usePid.getState();
                      if (!(st.multi.length > 1 && st.multi.includes(n.id))) select({ kind: "node", id: n.id });
                      if (locked) return;
                      beginTx(st.multi.length > 1 && st.multi.includes(n.id) ? `Mutare grup (${st.multi.length})` : `Mutare ${n.tag}`);
                      setDrag({ kind: "node", id: n.id, ox: w.x - n.x, oy: w.y - n.y, sx: w.x, sy: w.y });
                    }}
                    onDoubleClick={(e) => { e.stopPropagation(); if (!readOnly) { select({ kind: "node", id: n.id }); focusInspector(); } }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {halo && <rect data-ui="1" x={-8} y={-8} width={s.w + 16} height={s.h + 16} rx={6} fill={halo} fillOpacity={0.12} stroke={halo} strokeWidth={2} pointerEvents="none" />}
                    <rect data-ui="1" x={-4} y={-4} width={s.w + 8} height={s.h + 8} fill="transparent"
                      stroke={isSel ? "var(--primary)" : "none"} strokeDasharray="4 3" strokeWidth={1} />
                    {s.render()}
                    {s.source && n.intPump && (
                      <g pointerEvents="none">
                        <circle cx={s.w - 16} cy={s.h - 14} r={7} fill="var(--canvas-bg)" stroke="currentColor" strokeWidth={1.2} />
                        <text x={s.w - 16} y={s.h - 11} textAnchor="middle" fontSize={8} fontWeight={700} fontFamily="var(--app-mono)" fill="currentColor">P</text>
                      </g>
                    )}
                    {!readOnly && s.ports.map((pt) => {
                      const used = usedPorts.has(`${n.id}:${pt.id}`);
                      const act = pending?.node === n.id && pending.port === pt.id;
                      const role = s.roles?.[pt.id];
                      const rc = role ? circuitColor(scheme, role === "s" ? "supply" : "return") : "var(--primary)";
                      return (
                        <circle key={pt.id} data-ui="1" cx={pt.x} cy={pt.y} r={act ? 5.5 : used ? 2.5 : 4}
                          fill={act ? rc : used ? "var(--canvas-ink)" : "var(--canvas-bg)"}
                          stroke={rc} strokeWidth={1.2} style={{ cursor: "crosshair" }} data-port="1"
                          onPointerDown={(e) => onPortClick(e, n.id, pt.id)} onClick={(e) => e.stopPropagation()}>
                          <title>{role === "s" ? "Port TUR" : role === "r" ? "Port RETUR" : "Port"} {pt.id} – click pentru a trasa conductă</title>
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
                          if (locked) return;
                          beginTx(`Mutare etichetă ${n.tag}`);
                          setDrag({ kind: "code", id: n.id, x0: w.x, y0: w.y, dx0: cdx, dy0: cdy });
                        }}
                        onClick={(e) => e.stopPropagation()}>
                        <title>Trage pentru a muta eticheta</title>
                        {codeText}
                      </text>
                    )}
                    {!!n.kw && (s.terminal || s.source || s.bomGroup === "Echipamente") && (
                      <text x={0} y={s.h / 2 + (showTags ? 25 : 12) + ((s.terminal || s.source) && n.redundant ? 11 : 0)} textAnchor="middle" fontSize={9} fontFamily="var(--app-mono)" fill="var(--canvas-ink)" opacity={0.8} pointerEvents="none">
                        {n.kw} kW{n.kwSens ? ` / ${n.kwSens} kW sens.` : ""}
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
                    {incomplete && !readOnly && <circle data-ui="1" cx={s.w / 2 + 6} cy={-s.h / 2 - 6} r={3.5} fill="var(--destructive)" opacity={0.85} pointerEvents="none" />}
                  </g>
                </g>
              );
            })}
          </g>
          {showGuides && (scheme.guides ?? []).map((g) => (
            <line key={g.id} data-ui="1" pointerEvents="none"
              x1={g.dir === "v" ? g.pos : -20000} y1={g.dir === "v" ? -20000 : g.pos}
              x2={g.dir === "v" ? g.pos : 20000} y2={g.dir === "v" ? 20000 : g.pos}
              stroke="var(--primary)" strokeOpacity={0.45} strokeDasharray={`${12 / view.k} ${8 / view.k}`} strokeWidth={1 / view.k} />
          ))}
          {pendingPos && (
            <path d={`M${pendingPos.x} ${pendingPos.y} H${(snapTarget ?? mouse).x} V${(snapTarget ?? mouse).y}`} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
          )}
          {snapTarget && (
            <g pointerEvents="none">
              <circle cx={snapTarget.x} cy={snapTarget.y} r={9 / view.k} fill="none" stroke="var(--success)" strokeWidth={2 / view.k} />
              <rect x={snapTarget.x - 4 / view.k} y={snapTarget.y - 4 / view.k} width={8 / view.k} height={8 / view.k} fill="var(--success)" />
            </g>
          )}
          {drag?.kind === "box" && (
            <rect x={Math.min(drag.x0, mouse.x)} y={Math.min(drag.y0, mouse.y)} width={Math.abs(mouse.x - drag.x0)} height={Math.abs(mouse.y - drag.y0)}
              fill={mouse.x < drag.x0 ? "#22c55e" : "#3b82f6"} fillOpacity={0.12}
              stroke={mouse.x < drag.x0 ? "#22c55e" : "#3b82f6"} strokeDasharray={mouse.x < drag.x0 ? "5 4" : ""} strokeWidth={1 / view.k} pointerEvents="none" />
          )}
        </g>
        {/* cursor crosshair cu pickbox, ca într-un mediu CAD */}
        {!readOnly && cursor && !drag && (
          <g pointerEvents="none" stroke="var(--primary)" strokeOpacity={0.45} strokeWidth={0.8}>
            <line x1={0} y1={cursor.y} x2="100%" y2={cursor.y} />
            <line x1={cursor.x} y1={0} x2={cursor.x} y2="100%" />
            <rect x={cursor.x - 5} y={cursor.y - 5} width={10} height={10} fill="none" strokeOpacity={0.9} />
          </g>
        )}
      </svg>
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        {!readOnly && scheme.nodes.some((n) => { const s = getSymbol(n.type); return s.ports.length > 1 && !scheme.pipes.some((p) => p.from.node === n.id || p.to.node === n.id); }) && (
          <div className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-[11px] text-destructive backdrop-blur">
            <AlertTriangle className="h-3.5 w-3.5" /> Există elemente neconectate
          </div>
        )}
        {selected?.kind === "pipe" && <PipeHud pipeId={selected.id} scheme={scheme} />}
      </div>
      <div className="absolute bottom-10 right-3 flex gap-1">
        {!readOnly && <>
          <Button size="icon" variant={heat ? "default" : "secondary"} title="Mod Hydraulic: viteze din solverul de rețea"
            onClick={() => setVisualMode(heat ? "design" : "hydraulic")}><Flame className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" title="Linie ajutătoare orizontală la centrul zonei vizibile"
            onClick={() => { const r = svgRef.current?.getBoundingClientRect(); addGuide("h", r ? (r.height / 2 - view.y) / view.k : -view.y / view.k); }}><Ruler className="h-4 w-4 rotate-90" /></Button>
          <Button size="icon" variant="secondary" title="Linie ajutătoare verticală la centrul zonei vizibile"
            onClick={() => { const r = svgRef.current?.getBoundingClientRect(); addGuide("v", r ? (r.width / 2 - view.x) / view.k : -view.x / view.k); }}><Ruler className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" title="Șterge toate liniile ajutătoare" disabled={!(scheme.guides ?? []).length}
            onClick={() => clearGuides()}><Eraser className="h-4 w-4" /></Button>
        </>}
        <Button size="icon" variant="secondary" title="Apropie" onClick={() => setView((v) => ({ ...v, k: Math.min(4, v.k * 1.2) }))}><ZoomIn className="h-4 w-4" /></Button>
        <Button size="icon" variant="secondary" title="Depărtează" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))}><ZoomOut className="h-4 w-4" /></Button>
        <Button size="icon" variant="secondary" title="Încadrează tot desenul (E · dublu-click pe rotiță)" onClick={() => zoomExtents()}><Maximize className="h-4 w-4" /></Button>
      </div>
      {!readOnly && visualMode !== "design" && <ModeLegend mode={visualMode} />}
      {/* bară de stare stil CAD */}
      {!readOnly && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 border-t bg-card/95 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
          <span className="whitespace-nowrap tabular-nums">{(mouse.x / 40).toFixed(2)}, {(mouse.y / 40).toFixed(2)} m</span>
          <span className="opacity-40">|</span>
          <span className="tabular-nums">{Math.round(view.k * 100)}%</span>
          <span className="opacity-40">|</span>
          {([["ortho", "ORTHO", "F8"], ["osnap", "OSNAP", "F3"], ["showGrid", "GRID", "F7"]] as const).map(([key, label, k]) => (
            <button key={key} type="button" title={`${label} (${k})`}
              onClick={() => setCad({ [key]: !cad[key] })}
              className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide ${cad[key] ? "bg-primary/20 text-primary" : "hover:bg-muted"}`}>
              {label}
            </button>
          ))}
          <span className="opacity-40">|</span>
          <span title="Obiecte selectate">SEL {multi.length + multiPipes.length || (selected ? 1 : 0)}</span>
          <span className="opacity-40">|</span>
          <span title="Strat curent – obiectele noi intră aici">LAYER {LAYERS.find((l) => l.id === currentLayer)?.name}</span>
          <span className="opacity-40">|</span>
          <span title="Mod vizual">MODE {visualMode.toUpperCase()}</span>
          <span className="opacity-40">|</span>
          <span>m · kPa · m³/h</span>
          {scheme.nodes.some((n) => nodeLocked(scheme, n)) && <Lock className="h-3 w-3" />}
          <span className="ml-auto truncate pl-2">
            {pending ? "Click pe un alt port pentru a finaliza conducta · Esc anulează"
              : multi.length > 1 ? `${multi.length} elemente selectate · trage pentru mutare · Ctrl+C/V copiază · Del șterge`
              : "Trage pe fundal = selecție (→ fereastră, ← crossing) · rotiță = pan · dublu-click rotiță = încadrare"}
          </span>
        </div>
      )}
    </div>
  );
}

/** Fișa de calcul hidraulic a conductei selectate, afișată direct pe desen. */
function PipeHud({ pipeId, scheme }: { pipeId: string; scheme: Scheme }) {
  const pipe = scheme.pipes.find((p) => p.id === pipeId);
  if (!pipe || pipe.direct) return null;
  const f = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const r = computePipe(pipe, scheme, f);
  const [lo, hi] = velocityLimits(pipe.dn, scheme);
  const bad = !!r.velWarn;
  return (
    <div className="w-60 rounded-md border bg-card/95 p-2.5 text-[11px] shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between font-medium text-foreground">
        <span>{pipe.tag || "Conductă"} · DN{pipe.dn}</span>
        <span className="text-muted-foreground">{r.L.toFixed(1)} m</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono tabular-nums">
        <dt className="text-muted-foreground">Debit</dt><dd className="text-right">{pipe.flow.toFixed(2)} m³/h</dd>
        <dt className="text-muted-foreground">Viteză</dt><dd className={`text-right ${bad ? "font-medium text-destructive" : ""}`}>{r.v.toFixed(2)} m/s</dd>
        <dt className="text-muted-foreground">Recomandat</dt><dd className="text-right text-muted-foreground">{lo.toFixed(1)}–{hi.toFixed(1)}</dd>
        <dt className="text-muted-foreground">R</dt><dd className="text-right">{r.R.toFixed(0)} Pa/m</dd>
        <dt className="text-muted-foreground">Δp liniar</dt><dd className="text-right">{fmtP(r.dpLin, "kPa")} kPa</dd>
        <dt className="text-muted-foreground">Δp local</dt><dd className="text-right">{fmtP(r.dpLoc + r.dpComp, "kPa")} kPa</dd>
        <dt className="text-muted-foreground">Δp total</dt><dd className="text-right font-medium text-foreground">{fmtP(r.dpTotal, "kPa")} kPa</dd>
        {!!pipe.kw && <><dt className="text-muted-foreground">Putere</dt><dd className="text-right">{pipe.kw.toFixed(1)} kW</dd></>}
        <dt className="text-muted-foreground">Fluid</dt><dd className="text-right">ρ {f.rho.toFixed(0)} kg/m³</dd>
      </dl>
      {bad && <div className="mt-1.5 text-destructive">Viteză {r.velWarn === "low" ? "sub" : "peste"} intervalul recomandat pentru DN{pipe.dn}.</div>}
    </div>
  );
}

function PipeView({ pipe, scheme, crossings, selected, onSelect, onDouble, showTags, onSegDown, critical = false, heat = false, overlayColor }: {
  pipe: Pipe; scheme: Scheme; crossings: { x: number; y: number; pipeId: string }[]; selected: boolean; onSelect: (e: React.PointerEvent) => void; showTags: boolean;
  onDouble?: (() => void) | undefined;
  onSegDown?: ((e: React.PointerEvent, i: number, pts: { x: number; y: number }[]) => void) | undefined;
  critical?: boolean; heat?: boolean; overlayColor?: string | undefined;
}) {
  const pts = pipeRoute(pipe, scheme);
  if (pts.length < 2) return null;
  const di = innerDiameterMm(pipe.material, pipe.dn) / 1000;
  const vel = di > 0 ? pipe.flow / 3600 / ((Math.PI * di * di) / 4) : 0;
  const color = overlayColor ?? circuitColor(scheme, pipe.circuit);
  const w = 2 + Math.min(4, pipe.dn / 70);

  if (pipe.direct) {
    const a = pts[0]!, b = pts[pts.length - 1]!;
    return (
      <g onPointerDown={(e) => { e.stopPropagation(); onSelect(e); }} onDoubleClick={(e) => { e.stopPropagation(); onDouble?.(); }} onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={w} />
        {critical && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--destructive)" strokeWidth={w + 7} strokeOpacity={0.3} pointerEvents="none" />}
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
    <g data-layer={`CONDUCTE_${pipe.circuit}`} onPointerDown={(e) => { e.stopPropagation(); onSelect(e); }} onDoubleClick={(e) => { e.stopPropagation(); onDouble?.(); }} onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}
      opacity={pipe.disabled ? 0.4 : 1}>
      <path data-ui="1" d={d} fill="none" stroke="transparent" strokeWidth={14} />
      {critical && <path d={d} fill="none" stroke="var(--destructive)" strokeWidth={w + 7} strokeOpacity={0.3} strokeLinejoin="round" pointerEvents="none" />}
      {selected && <path data-ui="1" d={d} fill="none" stroke="var(--primary)" strokeWidth={w + 5} strokeOpacity={0.35} />}
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinejoin="round" strokeDasharray={pipe.disabled ? "8 6" : undefined} />
      {selected && onSegDown && pts.slice(1).map((p, k) => {
        const q = pts[k]!, hz = Math.abs(p.y - q.y) < 1;
        if (Math.hypot(p.x - q.x, p.y - q.y) < 4) return null;
        return (
          <g key={k} data-ui="1">
            <line x1={q.x} y1={q.y} x2={p.x} y2={p.y} stroke="transparent" strokeWidth={12}
              style={{ cursor: hz ? "ns-resize" : "ew-resize" }} onPointerDown={(e) => onSegDown(e, k + 1, pts)} />
            <rect x={(p.x + q.x) / 2 - 4} y={(p.y + q.y) / 2 - 4} width={8} height={8} fill="var(--primary)" stroke="var(--canvas-bg)"
              style={{ cursor: hz ? "ns-resize" : "ew-resize" }} onPointerDown={(e) => onSegDown(e, k + 1, pts)}>
              <title>Trage pentru a muta tronsonul</title>
            </rect>
          </g>
        );
      })}
      {best > 30 && <path d="M-7 -5 L5 0 L-7 5 Z" fill={color} transform={`translate(${mx},${my}) rotate(${ang})`} />}
      {best > 50 && (
        <g pointerEvents="none" fontFamily="var(--app-mono)">
          <text x={horiz ? mx : mx + 8} y={horiz ? my - 9 : my - 4} fontSize={10} fill={color} textAnchor={horiz ? "middle" : "start"}>
            {showTags ? `${pipe.tag} · DN${pipe.dn}` : `DN${pipe.dn}`}{pipe.disabled ? " · SCOS" : ""}
          </text>
          {heat && pipe.flow > 0 && !pipe.direct && (
            <text x={horiz ? mx : mx + 8} y={horiz ? my + 26 : my + 19} fontSize={8} fill={color} textAnchor={horiz ? "middle" : "start"}>
              {vel.toFixed(2)} m/s
            </text>
          )}
          <text x={horiz ? mx : mx + 8} y={horiz ? my + 15 : my + 8} fontSize={8} fill="var(--canvas-ink)" opacity={0.45} textAnchor={horiz ? "middle" : "start"}>
            {pipe.length.toFixed(1)} m
          </text>
        </g>
      )}
    </g>
  );
}

const LEGENDS: Record<Exclude<VisualMode, "design">, { title: string; items: [string, string][] }> = {
  hydraulic: { title: "Hydraulic – viteză (solver de rețea)", items: [["var(--success)", "în intervalul recomandat"], ["var(--warning)", "sub interval"], ["var(--destructive)", "peste interval / nerezolvat"], ["var(--muted-foreground)", "fără debit"]] },
  critical: { title: "Critical Path", items: [["var(--destructive)", "traseul critic și nodurile lui"]] },
  check: { title: "Engineering Check", items: [["var(--warning)", "warning"], ["var(--muted-foreground)", "incomplete"], ["var(--destructive)", "unresolved"]] },
  mto: { title: "MTO", items: [["var(--canvas-ink)", "tag · DN · lungime pe conducte"]] },
};

function ModeLegend({ mode }: { mode: VisualMode }) {
  const setVisualMode = usePid((s) => s.setVisualMode);
  if (mode === "design") return null;
  const L = LEGENDS[mode];
  return (
    <div className="absolute bottom-10 left-3 rounded-md border bg-card/95 p-2 text-[11px] shadow backdrop-blur">
      <div className="mb-1 flex items-center justify-between gap-3 font-medium">{L.title}
        <button className="text-muted-foreground hover:text-foreground" onClick={() => setVisualMode("design")} title="Înapoi la Design">×</button>
      </div>
      {L.items.map(([c, t]) => (
        <div key={t} className="flex items-center gap-2"><span className="h-1 w-5 rounded" style={{ background: c }} />{t}</div>
      ))}
      <div className="mt-1 text-[10px] text-muted-foreground">Doar vizualizare – modelul nu se modifică.</div>
    </div>
  );
}
