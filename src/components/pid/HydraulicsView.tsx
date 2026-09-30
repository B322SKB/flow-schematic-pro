import { useMemo, useState } from "react";
import { AlertTriangle, Crosshair, RotateCcw, Sigma, Snowflake, Wand2 } from "lucide-react";
import { DN_LIST } from "@/lib/pid/catalog";
import { DEFAULT_MAX_R, limitsFor } from "@/lib/pid/velocity";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { propagateFlows, pumpDuty } from "@/lib/pid/network";
import { expansionSizing, volumeTotals } from "@/lib/pid/volume";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CIRCUITS, circuitColor, getMaterial, sizeLabel, type CircuitId } from "@/lib/pid/catalog";
import { FLUID_LABEL, fluidProps, type FluidId } from "@/lib/pid/fluids";
import { computePipe, fmtP, type PUnit } from "@/lib/pid/hydraulics";
import { usePid } from "@/lib/pid/store";
import { PidCanvas } from "./Canvas";
import { Switch } from "@/components/ui/switch";
import { Field, Sel } from "./fields";

export function FluidCard() {
  const { scheme, setScheme } = usePid();
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const freezeRisk = scheme.temperature < fp.freeze + 3;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">Fluid de lucru</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Field label="Fluid">
          <Sel<FluidId> value={scheme.fluid} onChange={(v) => setScheme({ fluid: v })}
            options={(Object.keys(FLUID_LABEL) as FluidId[]).map((f) => ({ value: f, label: FLUID_LABEL[f] }))} />
        </Field>
        {scheme.fluid !== "water" && (
          <Field label={`Concentrație: ${scheme.concentration}%`}>
            <Slider min={0} max={60} step={1} value={[scheme.concentration]} onValueChange={([v]) => setScheme({ concentration: v ?? 0 })} />
          </Field>
        )}
        <Field label={`Temperatură: ${scheme.temperature} °C`}>
          <Slider min={-20} max={90} step={1} value={[scheme.temperature]} onValueChange={([v]) => setScheme({ temperature: v ?? 0 })} />
        </Field>
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <Prop k="ρ" v={`${fp.rho.toFixed(1)} kg/m³`} />
          <Prop k="μ" v={`${(fp.mu * 1000).toFixed(3)} mPa·s`} />
          <Prop k="ν" v={`${(fp.nu * 1e6).toFixed(3)} mm²/s`} />
          <Prop k="cp" v={`${(fp.cp / 1000).toFixed(3)} kJ/kg·K`} />
          <Prop k="T îngheț" v={`${fp.freeze.toFixed(1)} °C`} />
        </div>
        {freezeRisk && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            <Snowflake className="mt-0.5 h-4 w-4 shrink-0" /> Temperatura este sub/aproape de punctul de îngheț. Măriți concentrația de glicol.
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Proprietăți calculate prin corelații inginerești (precizie ±5%).</p>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1"><span className="text-muted-foreground">{k}</span><span className="font-mono text-foreground">{v}</span></div>;
}

function Prop({ k, v }: { k: string; v: string }) {
  return <div className="rounded border bg-muted/40 px-2 py-1.5"><div className="text-muted-foreground">{k}</div><div className="text-foreground">{v}</div></div>;
}

/** Tabelul de viteze recomandate pe diametru, editabil de utilizator. */
function VelocityCard() {
  const { scheme, setScheme, setVelocityLimit, resetVelocityLimits } = usePid();
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">Viteze recomandate pe diametru</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">Valorile de aici sunt folosite la avertizările de viteză și la auto-dimensionarea conductelor.</p>
        <div className="max-h-64 overflow-auto rounded-md border">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr><th className="p-1.5 text-left font-sans font-medium">DN</th><th className="p-1.5 font-sans font-medium">v min</th><th className="p-1.5 font-sans font-medium">v max</th></tr>
            </thead>
            <tbody>
              {DN_LIST.map((dn) => {
                const [lo, hi] = limitsFor(dn, scheme);
                return (
                  <tr key={dn} className="border-t">
                    <td className="p-1 pl-1.5">DN{dn}</td>
                    <td className="p-1"><Input type="number" step="0.1" className="h-6 w-16 px-1 text-center font-mono text-[11px]" value={lo}
                      onChange={(e) => setVelocityLimit(dn, +e.target.value, hi)} /></td>
                    <td className="p-1"><Input type="number" step="0.1" className="h-6 w-16 px-1 text-center font-mono text-[11px]" value={hi}
                      onChange={(e) => setVelocityLimit(dn, lo, +e.target.value)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Field label="Pierdere liniară maximă admisă [Pa/m]">
          <Input type="number" step="10" className="h-8 font-mono text-xs" value={scheme.maxR ?? DEFAULT_MAX_R}
            onChange={(e) => setScheme({ maxR: +e.target.value || DEFAULT_MAX_R })} />
        </Field>
        <Button size="sm" variant="secondary" className="w-full gap-1.5" onClick={() => { resetVelocityLimits(); toast.success("Valorile implicite au fost restaurate."); }}>
          <RotateCcw className="h-3.5 w-3.5" />Restaurează valorile implicite
        </Button>
      </CardContent>
    </Card>
  );
}

export function HydraulicsView() {
  const { scheme, setScheme, updatePipe, select, applyAutoFlows, autoSizePipes } = usePid();
  const [pu, setPu] = useState<PUnit>("kPa");
  const [qu, setQu] = useState<"m3h" | "ls">("m3h");
  const [filter, setFilter] = useState<"all" | "warn" | "crit">("all");
  const [focus, setFocus] = useState<string | null>(null);
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const results = scheme.pipes.filter((p) => !p.disabled).map((p) => ({ p, r: computePipe(p, scheme, fp) }));
  const disabled = scheme.pipes.filter((p) => p.disabled);
  const byCircuit = new Map<CircuitId, { L: number; dp: number; n: number }>();
  for (const { p, r } of results) {
    const c = byCircuit.get(p.circuit) ?? { L: 0, dp: 0, n: 0 };
    c.L += r.L; c.dp += r.dpTotal; c.n++;
    byCircuit.set(p.circuit, c);
  }
  const total = results.reduce((s, x) => s + x.r.dpTotal, 0);
  const warns = results.filter((x) => x.r.velWarn).length;
  const duty = useMemo(() => pumpDuty(scheme, fp), [scheme, fp]);
  const auto = useMemo(() => propagateFlows(scheme, fp), [scheme, fp]);
  const vol = useMemo(() => volumeTotals(scheme), [scheme]);
  const exp = useMemo(() => expansionSizing(scheme), [scheme]);
  const critical = duty.path?.pipes ?? [];
  const critSet = new Set(critical);
  const tagOf = (id: string) => scheme.pipes.find((p) => p.id === id)?.tag ?? "";
  const drift = scheme.pipes.filter((p) => {
    const a = auto.get(p.id);
    return a && !a.ambiguous && Math.abs(a.flow - p.flow) > 0.05;
  });
  const ringPipes = [...auto.entries()].filter(([, v]) => v.ambiguous).map(([id]) => tagOf(id));
  const shown = results.filter(({ p, r }) => filter === "all" || (filter === "warn" ? !!r.velWarn : critSet.has(p.id)));

  return (
    <div className="h-full overflow-auto p-4">
    <div className="grid grid-cols-[320px_1fr] gap-4">
      <div className="space-y-4">
        <FluidCard />
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Unități</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ToggleGroup type="single" variant="outline" size="sm" value={pu} onValueChange={(v) => v && setPu(v as PUnit)}>
              <ToggleGroupItem value="kPa">kPa</ToggleGroupItem><ToggleGroupItem value="bar">bar</ToggleGroupItem><ToggleGroupItem value="mCA">mCA</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="single" variant="outline" size="sm" value={qu} onValueChange={(v) => v && setQu(v as "m3h" | "ls")}>
              <ToggleGroupItem value="m3h">m³/h</ToggleGroupItem><ToggleGroupItem value="ls">l/s</ToggleGroupItem>
            </ToggleGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Totaluri pe circuit</CardTitle></CardHeader>
          <CardContent className="space-y-2 font-mono text-xs">
            {[...byCircuit.entries()].map(([c, v]) => (
              <div key={c} className="flex items-center justify-between rounded border px-2 py-1.5">
                <span className="flex items-center gap-2 font-sans"><span className="h-2.5 w-2.5 rounded-full" style={{ background: circuitColor(scheme, c) }} />{CIRCUITS[c].name}</span>
                <span>{v.L.toFixed(1)} m · <b className="text-primary">{fmtP(v.dp, pu, fp.rho)} {pu}</b></span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-sm font-semibold"><span className="font-sans">Circuit complet</span><span className="text-primary">{fmtP(total, pu, fp.rho)} {pu}</span></div>
            <p className="font-sans text-[11px] text-muted-foreground">Include pierderile liniare, fitingurile, vanele și căderile de presiune ale echipamentelor.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Debite automate (însumare la teuri)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-muted-foreground">
              Debitele se însumează de la consumatorii activi spre sursă. Elementele marcate redundant nu intră în calcul.
            </p>
            <Button size="sm" className="w-full gap-1.5" onClick={() => {
              const r = applyAutoFlows();
              const extra = [
                r.ambiguous ? `${r.ambiguous} tronson(e) de inel rămân manuale` : "",
                r.unresolved ? `${r.unresolved} tronson(e) fără legătură la o sursă` : "",
                ...r.notes,
              ].filter(Boolean).join(" · ");
              toast.success(`${r.updated} tronson(e) actualizate · cerere totală ${r.demand} m³/h${extra ? ` · ${extra}` : ""}`);

            }}>
              <Sigma className="h-3.5 w-3.5" />Calculează debitele automat
            </Button>
            <Button size="sm" variant="secondary" className="w-full gap-1.5" onClick={() => {
              const r = autoSizePipes();
              const skip = r.skipped ? ` · ${r.skipped} tronson(e) fără debit au fost sărite` : "";
              toast.success(r.pipes || r.valves
                ? `Auto-dimensionare: ${r.pipes} tronson(e) redimensionate · ${r.valves} vană(e) actualizate${skip}`
                : `Dimensiunile actuale respectă vitezele din tabel și R ≤ ${scheme.maxR ?? DEFAULT_MAX_R} Pa/m.${skip}`);
            }}>
              <Wand2 className="h-3.5 w-3.5" />Auto-dimensionare DN (viteze din tabel)
            </Button>
            {drift.length > 0 && (
              <p className="text-warning">
                Diferă de cererea consumatorilor: {drift.slice(0, 6).map((p) => p.tag).join(", ")}{drift.length > 6 ? "…" : ""}
              </p>
            )}
            {ringPipes.length > 0 && (
              <p className="text-muted-foreground">Tronsoane de inel (debit manual): {ringPipes.join(", ")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Traseu critic și punct de funcționare</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {duty.path ? (
              <>
                <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {duty.path.pipes.map(tagOf).join(" → ")} → <b className="text-foreground">{duty.path.endTag}</b>
                </p>
                <Row k="Δp traseu critic" v={`${fmtP(duty.dpCritical, pu, fp.rho)} ${pu}`} />
                {duty.integratedHead > 0 && <Row k="Presiune utilă modul integrat" v={`${(duty.integratedHead / 1000).toFixed(0)} kPa`} />}
                <Row k="Sarcină pompă exterioară" v={`${duty.headM.toFixed(1)} mCA`} />
                <Row k="Sarcină cu marjă 10%" v={`${duty.margin.toFixed(1)} mCA`} />
                <Row k="Debit total" v={`${duty.flow.toFixed(2)} m³/h`} />
                {duty.covered && <Badge className="bg-success text-success-foreground">Modulul hidraulic integrat acoperă circuitul</Badge>}
                <p className="text-[11px] text-muted-foreground">Traseul critic este evidențiat pe schema de mai jos.</p>
              </>
            ) : <p className="text-muted-foreground">Adaugă o sursă (chiller) și conducte pentru a determina traseul critic.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Volum de fluid și vas de expansiune</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-xs">
            <section className="space-y-1.5">
              <h4 className="font-sans font-medium text-foreground">1 · Cât fluid conține instalația</h4>
              <Row k="În conducte" v={`${vol.pipes.toFixed(0)} l`} />
              <Row k="În echipamente și rezervoare" v={`${vol.equipment.toFixed(0)} l`} />
              <Row k="Total de umplut" v={`${vol.total.toFixed(0)} l`} />
              <Row k="Din care apă" v={`${vol.water.toFixed(0)} l`} />
              <Row k="Din care glicol pur" v={`${vol.glycolPure.toFixed(0)} l`} />
              <p className="text-[11px] text-muted-foreground">Cantitățile de cumpărat pentru prima umplere, la concentrația de {scheme.concentration}%.</p>
            </section>
            <section className="space-y-1.5">
              <h4 className="font-sans font-medium text-foreground">2 · Cât se dilată la încălzire</h4>
              <Field label="Temperatura maximă a fluidului (stagnare) [°C]">
                <Input type="number" className="h-8 font-mono text-xs" value={scheme.tStagnation ?? 40}
                  onChange={(e) => setScheme({ tStagnation: +e.target.value })} />
              </Field>
              <Row k={`Între ${exp.tMin} și ${exp.tMax} °C`} v={`+${(exp.expansionFactor * 100).toFixed(2)} %`} />
              <Row k="Volum de dilatare (Ve)" v={`${exp.expansionVolume.toFixed(0)} l`} />
            </section>
            <section className="space-y-1.5">
              <h4 className="font-sans font-medium text-foreground">3 · Rezerva de apă</h4>
              <Row k="Rezervă (min. 0,5% sau 3 l)" v={`${exp.reserve.toFixed(0)} l`} />
              <Row k="Volum util necesar (Vu)" v={`${exp.utilVolume.toFixed(0)} l`} />
              <p className="text-[11px] text-muted-foreground">Rezerva acoperă micile pierderi și menține presiunea la rece.</p>
            </section>
            <section className="space-y-1.5">
              <h4 className="font-sans font-medium text-foreground">4 · Vasul de expansiune</h4>
              <Field label="Înălțimea statică a instalației [m]">
                <Input type="number" className="h-8 font-mono text-xs" value={scheme.staticHeight ?? 15}
                  onChange={(e) => setScheme({ staticHeight: +e.target.value })} />
              </Field>
              <Field label="Presiunea supapei de siguranță [bar]">
                <Input type="number" step="0.5" className="h-8 font-mono text-xs" value={scheme.reliefPressure ?? 3}
                  onChange={(e) => setScheme({ reliefPressure: +e.target.value })} />
              </Field>
              <Row k="Preîncărcare vas (p0)" v={`${(exp.p0 - 1).toFixed(1)} bar`} />
              <Row k="Presiune finală (pe)" v={`${(exp.pe - 1).toFixed(1)} bar`} />
              <Row k="Randament vas" v={`${(exp.efficiency * 100).toFixed(0)} %`} />
              <Row k="Volum minim calculat (Vn)" v={`${exp.nominal} l`} />
              <Row k="Mărime comercială recomandată" v={`${exp.standard} l`} />
              <Row k="Prevăzut în schemă" v={`${exp.installed.toFixed(0)} l`} />
              {!exp.ok && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Vasul prevăzut este prea mic. Alege un vas de {exp.standard} l și setează-i volumul pe element.
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Vn = Vu · pe / (pe − p0), presiuni absolute; p0 = înălțime/10 + 0,3 bar.</p>
            </section>
          </CardContent>
        </Card>
        <VelocityCard />
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Scenariu rețea inel</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-muted-foreground">Scoate din funcțiune tronsonul care creează situația cea mai dezavantajată. Tronsoanele scoase sunt excluse din calcul și apar punctat pe desen. Ajustează debitele pe tronsoanele rămase în funcțiune.</p>
            <div className="max-h-48 space-y-1 overflow-auto">
              {scheme.pipes.filter((p) => !p.direct).map((p) => (
                <label key={p.id} className="flex items-center justify-between rounded border px-2 py-1 font-mono">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: circuitColor(scheme, p.circuit) }} />{p.tag}</span>
                  <Switch checked={!!p.disabled} onCheckedChange={(v) => updatePipe(p.id, { disabled: v })} />
                </label>
              ))}
            </div>
            {disabled.length > 0 && <Badge variant="destructive">{disabled.length} tronson(e) scoase: {disabled.map((p) => p.tag).join(", ")}</Badge>}
          </CardContent>
        </Card>
      </div>
      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">Calcul pe segmente · Darcy-Weisbach + Colebrook-White</CardTitle>
          <div className="flex items-center gap-2">
            <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as typeof filter)}>
              <ToggleGroupItem value="all">Toate</ToggleGroupItem>
              <ToggleGroupItem value="warn">Avertizări</ToggleGroupItem>
              <ToggleGroupItem value="crit">Traseu critic</ToggleGroupItem>
            </ToggleGroup>
            {warns > 0 && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{warns}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Crosshair className="h-3.5 w-3.5" />Click pe un rând aduce conducta în centrul schemei de mai jos; click pe o conductă în schemă afișează fișa ei de calcul.</p>
          <Table className="font-mono text-xs">
            <TableHeader>
              <TableRow>
                {["Tag", "Material / DN", "L [m]", `Q [${qu === "m3h" ? "m³/h" : "l/s"}]`, "v [m/s]", "Re", "λ", "R [Pa/m]", "ΣK", `Δp lin`, `Δp loc`, `Δp elem`, `Δp total [${pu}]`].map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map(({ p, r }) => (
                <TableRow key={p.id} className={`cursor-pointer ${focus === p.id ? "bg-primary/10" : critSet.has(p.id) ? "bg-destructive/10" : ""}`}
                  onClick={() => { select({ kind: "pipe", id: p.id }); setFocus(p.id); }}>
                  <TableCell className="whitespace-nowrap"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: circuitColor(scheme, p.circuit) }} />{p.tag}{p.direct && <span className="ml-1 text-muted-foreground">(direct)</span>}{critSet.has(p.id) && <span className="ml-1 text-destructive">★</span>}</TableCell>
                  <TableCell className="whitespace-nowrap font-sans">{getMaterial(p.material).short} {sizeLabel(p.material, p.dn)}</TableCell>
                  <TableCell>{r.L.toFixed(1)}</TableCell>
                  <TableCell>
                    <Input type="number" step="0.1" className="h-7 w-20 font-mono text-xs"
                      value={qu === "m3h" ? p.flow : +(p.flow / 3.6).toFixed(3)}
                      onChange={(e) => updatePipe(p.id, { flow: qu === "m3h" ? +e.target.value : +e.target.value * 3.6 })} />
                  </TableCell>
                  <TableCell className={r.velWarn === "high" ? "text-destructive" : r.velWarn === "low" ? "text-warning" : ""}>
                    {r.v.toFixed(2)}{r.velWarn && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{Math.round(r.Re)} <span className="text-muted-foreground">{r.regime.charAt(0).toUpperCase()}</span></TableCell>
                  <TableCell>{r.f.toFixed(4)}</TableCell>
                  <TableCell>{r.R.toFixed(0)}</TableCell>
                  <TableCell>{r.Ksum.toFixed(2)}</TableCell>
                  <TableCell>{fmtP(r.dpLin, pu, fp.rho)}</TableCell>
                  <TableCell>{fmtP(r.dpLoc, pu, fp.rho)}</TableCell>
                  <TableCell>{fmtP(r.dpComp, pu, fp.rho)}</TableCell>
                  <TableCell className="font-semibold text-primary">{fmtP(r.dpTotal, pu, fp.rho)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!shown.length && <p className="py-6 text-center text-xs text-muted-foreground">Niciun tronson nu corespunde filtrului selectat.</p>}
          <p className="mt-3 text-[11px] text-muted-foreground">Vitezele recomandate se pot modifica în tabelul „Viteze recomandate pe diametru”. L = laminar (Re&lt;2300), T = turbulent.</p>
        </CardContent>
      </Card>
    </div>
      <Card className="mt-4">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Schemă cu coduri pentru trasabilitatea calculului</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[560px] overflow-hidden rounded-md border">
            <PidCanvas readOnly showTags critical={critical} focus={focus} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
