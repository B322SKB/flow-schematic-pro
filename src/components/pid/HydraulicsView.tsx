import { useMemo, useState } from "react";
import { AlertTriangle, Sigma, Snowflake } from "lucide-react";
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

export function HydraulicsView() {
  const { scheme, updatePipe, select, applyAutoFlows } = usePid();
  const [pu, setPu] = useState<PUnit>("kPa");
  const [qu, setQu] = useState<"m3h" | "ls">("m3h");
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
              toast.success(`${r.updated} tronson(e) actualizate${r.ambiguous ? ` · ${r.ambiguous} tronson(e) de inel rămân manuale` : ""}`);
            }}>
              <Sigma className="h-3.5 w-3.5" />Calculează debitele automat
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
          <CardHeader className="pb-3"><CardTitle className="text-sm">Volum fluid și vas de expansiune</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <Row k="Volum conducte" v={`${vol.pipes.toFixed(0)} l`} />
            <Row k="Volum rezervoare" v={`${vol.equipment.toFixed(0)} l`} />
            <Row k="Volum total" v={`${vol.total.toFixed(0)} l`} />
            <Row k="Umplere" v={`${vol.water.toFixed(0)} l apă + ${vol.glycolPure.toFixed(0)} l glicol`} />
            <Row k={`Dilatare ${exp.tMin}…${exp.tMax} °C`} v={`${(exp.expansionFactor * 100).toFixed(2)} % = ${exp.expansionVolume.toFixed(0)} l`} />
            <Row k="Volum util necesar" v={`${exp.utilVolume.toFixed(0)} l`} />
            <Row k="Vas recomandat" v={`${exp.nominal} l`} />
            <Row k="Vas prevăzut în schemă" v={`${exp.installed.toFixed(0)} l`} />
            {!exp.ok && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Vasul de expansiune prevăzut este insuficient; recomandat minim {exp.nominal} l.
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Vn = Vu · pe/(pe − p0), cu p0 {(exp.p0 - 1).toFixed(1)} bar și pe {(exp.pe - 1).toFixed(1)} bar suprapresiune.
            </p>
          </CardContent>
        </Card>
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
          {warns > 0 && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{warns} avertizări viteză</Badge>}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="font-mono text-xs">
            <TableHeader>
              <TableRow>
                {["Tag", "Material / DN", "L [m]", `Q [${qu === "m3h" ? "m³/h" : "l/s"}]`, "v [m/s]", "Re", "λ", "R [Pa/m]", "ΣK", `Δp lin`, `Δp loc`, `Δp elem`, `Δp total [${pu}]`].map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map(({ p, r }) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => select({ kind: "pipe", id: p.id })}>
                  <TableCell className="whitespace-nowrap"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: circuitColor(scheme, p.circuit) }} />{p.tag}{p.direct && <span className="ml-1 text-muted-foreground">(direct)</span>}</TableCell>
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
          <p className="mt-3 text-[11px] text-muted-foreground">Limite viteză recomandate: ≤DN25 0,3–1,0 m/s · ≤DN50 0,4–1,5 · ≤DN100 0,5–2,0 · &gt;DN100 0,6–2,8 m/s. L = laminar (Re&lt;2300), T = turbulent.</p>
        </CardContent>
      </Card>
    </div>
      <Card className="mt-4">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Schemă cu coduri pentru trasabilitatea calculului</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[560px] overflow-hidden rounded-md border">
            <PidCanvas readOnly showTags critical={critical} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
