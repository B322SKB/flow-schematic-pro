import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FLUID_LABEL, fluidProps } from "@/lib/pid/fluids";
import { evaluatePumps, isPumpNode, parsePairs, type PumpData } from "@/lib/pid/pumps";
import { solveNetwork } from "@/lib/pid/solver";
import { usePid } from "@/lib/pid/store";
import { Field, Sel } from "./fields";

const empty = (tag: string): PumpData => ({ tag, curve: [], count: 1, arrangement: "single", mounting: "external", quality: "user-defined" });
const num = (v: string) => (v === "" ? undefined : Number(v));

export function PumpsView() {
  const { scheme, updateNode } = usePid();
  const fp = useMemo(() => fluidProps(scheme.fluid, scheme.concentration, scheme.temperature), [scheme.fluid, scheme.concentration, scheme.temperature]);
  const sol = useMemo(() => solveNetwork(scheme, fp), [scheme, fp]);
  const evals = useMemo(() => evaluatePumps(scheme, fp, sol), [scheme, fp, sol]);
  const pumps = scheme.nodes.filter(isPumpNode);

  return (
    <div className="h-full space-y-4 overflow-auto p-4 text-sm">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Fluid · {FLUID_LABEL[scheme.fluid]} {scheme.fluid !== "water" ? `${scheme.concentration}%` : ""} · {scheme.temperature} °C</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4 font-mono text-xs">
          <span>ρ {fp.rho.toFixed(1)} kg/m³</span><span>μ {(fp.mu * 1000).toFixed(3)} mPa·s</span><span>ν {(fp.nu * 1e6).toFixed(3)} mm²/s</span>
          <span>cp {(fp.cp / 1000).toFixed(3)} kJ/kgK</span><span>k {fp.k?.toFixed(3) ?? "—"} W/mK</span>
          <Badge variant={fp.dataSource === "reference" ? "secondary" : "destructive"}>{fp.dataSource === "reference" ? "date de referință (tabel)" : "ESTIMARE inginerească – nu date producător"}</Badge>
          {fp.rangeWarnings?.map((w) => <span key={w} className="text-destructive">{w}</span>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Punct cerut de sistem (solver: {sol.status})</CardTitle></CardHeader>
        <CardContent className="font-mono text-xs">
          Q = {sol.sourceFlow.toFixed(2)} m³/h · H = {(sol.systemDp / (fp.rho * 9.81)).toFixed(2)} mCA ({(sol.systemDp / 1000).toFixed(1)} kPa, traseu critic) · curba sistemului H = k·Q² (circuit închis)
          {sol.warnings.some((w) => w.code === "multi_source_split") && <p className="mt-1 text-destructive">Preliminary – equal split fallback: surse multiple fără curbe de pompă.</p>}
        </CardContent>
      </Card>

      {pumps.length === 0 && <p className="text-muted-foreground">Nicio pompă în schemă. Adaugă o pompă din paletă sau un chiller cu modul hidraulic integrat.</p>}
      {pumps.map((n) => {
        const p = n.pump ?? empty(n.tag);
        const set = (patch: Partial<PumpData>) => updateNode(n.id, { pump: { ...p, ...patch } });
        const ev = evals.find((e) => e.id === n.id)!;
        const r = ev.result;
        return (
          <Card key={n.id}>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">{n.tag}
              <Badge variant={ev.basis === "curve-based" ? "secondary" : "outline"}>{ev.basis === "curve-based" ? "Curve-based" : "Preliminary – fără curbă"}</Badge>
              {r.status.map((s) => <Badge key={s} variant={s === "ok" ? "secondary" : "destructive"}>{s}</Badge>)}
            </CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_1.2fr]">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Producător"><Input className="h-8" value={p.manufacturer ?? ""} onChange={(e) => set({ manufacturer: e.target.value })} /></Field>
                <Field label="Model"><Input className="h-8" value={p.model ?? ""} onChange={(e) => set({ model: e.target.value })} /></Field>
                <Field label="Nr. pompe"><Input className="h-8" type="number" min={1} value={p.count} onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                <Field label="Configurație"><Sel value={p.arrangement} onChange={(v) => set({ arrangement: v })} options={[{ value: "single", label: "Simplă" }, { value: "parallel", label: "Paralel" }, { value: "series", label: "Serie" }]} /></Field>
                <Field label="Q min / max [m³/h]"><div className="flex gap-1"><Input className="h-8" type="number" value={p.minFlow ?? ""} onChange={(e) => set({ minFlow: num(e.target.value) })} /><Input className="h-8" type="number" value={p.maxFlow ?? ""} onChange={(e) => set({ maxFlow: num(e.target.value) })} /></div></Field>
                <Field label="η motor / P motor [kW]"><div className="flex gap-1"><Input className="h-8" type="number" step={0.01} value={p.motorEfficiency ?? ""} onChange={(e) => set({ motorEfficiency: num(e.target.value) })} /><Input className="h-8" type="number" value={p.motorPower ?? ""} onChange={(e) => set({ motorPower: num(e.target.value) })} /></div></Field>
                <Field label="Turație [rpm]"><Input className="h-8" type="number" value={p.speed ?? ""} onChange={(e) => set({ speed: num(e.target.value) })} /></Field>
                <Field label="Sursă date"><Sel value={p.quality} onChange={(v) => set({ quality: v })} options={[{ value: "manufacturer", label: "Producător" }, { value: "user-defined", label: "Utilizator" }, { value: "engineering-estimate", label: "Estimare" }]} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Curbă Q [m³/h]  H [mCA]"><Textarea className="h-40 font-mono text-xs" placeholder={"0 30\n20 25\n40 15"} defaultValue={p.curve.map((c) => `${c.q} ${c.h}`).join("\n")}
                  onBlur={(e) => set({ curve: parsePairs(e.target.value).map(({ a, b }) => ({ q: a, h: b })) })} /></Field>
                <Field label="Randament Q  η (0–1)"><Textarea className="h-40 font-mono text-xs" placeholder={"10 0.55\n30 0.75"} defaultValue={(p.efficiency ?? []).map((c) => `${c.q} ${c.eta}`).join("\n")}
                  onBlur={(e) => set({ efficiency: parsePairs(e.target.value).map(({ a, b }) => ({ q: a, eta: b })) })} /></Field>
                <p className="col-span-2 text-[11px] text-muted-foreground">Curba pentru o singură pompă, din fișa producătorului. Fără extrapolare în afara punctelor.</p>
              </div>
              <div className="space-y-1 font-mono text-xs">
                {r.basis === "unavailable" ? (
                  <p className="font-sans text-muted-foreground">Punct de funcționare indisponibil — introdu curba H(Q). Sarcina cerută (estimare preliminară): {ev.demandQ.toFixed(2)} m³/h @ {ev.demandH.toFixed(2)} mCA.</p>
                ) : (<>
                  <div>Q funcționare: <b>{r.q.toFixed(2)}</b> m³/h ({r.qPerPump.toFixed(2)} / pompă)</div>
                  <div>H: <b>{r.h.toFixed(2)}</b> mCA · Δp {(r.dp / 1000).toFixed(1)} kPa</div>
                  <div>η pompă: {r.eta ? (r.eta * 100).toFixed(1) + " %" : "lipsă"}</div>
                  <div>P hidraulică: {r.hydraulicKw.toFixed(2)} kW</div>
                  <div>P ax: {r.shaftKw?.toFixed(2) ?? "—"} kW · P motor necesară: {r.motorKwRequired?.toFixed(2) ?? "—"} kW</div>
                  <div className="text-muted-foreground">Cerut de sistem: {ev.demandQ.toFixed(2)} m³/h @ {ev.demandH.toFixed(2)} mCA · NPSH: nedisponibil</div>
                </>)}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
