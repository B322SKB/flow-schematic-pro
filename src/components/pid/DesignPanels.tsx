import { useMemo } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { engineeringCheck, type CheckLevel } from "@/lib/pid/checks";
import type { FluidProps } from "@/lib/pid/fluids";
import { planSizing, SIZING_MODE_LABEL, type SizingMode } from "@/lib/pid/sizing";
import type { SolverResult } from "@/lib/pid/solver";
import { usePid } from "@/lib/pid/store";
import { maxR } from "@/lib/pid/velocity";
import { Sel } from "./fields";

const LEVEL_CLS: Record<CheckLevel, string> = {
  ok: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  incomplete: "bg-secondary text-secondary-foreground",
  unresolved: "bg-destructive text-destructive-foreground",
};

export function LevelBadge({ level }: { level: CheckLevel }) {
  return <Badge className={LEVEL_CLS[level]}>{level === "ok" ? "OK" : level.charAt(0).toUpperCase() + level.slice(1)}</Badge>;
}

/** Mod de dimensionare + Apply / Undo. */
export function SizingControls({ mode, setMode }: { mode: SizingMode; setMode: (m: SizingMode) => void }) {
  const { autoSizePipes, undoSizing, sizingUndo, scheme } = usePid();
  return (
    <div className="space-y-2">
      <Sel label="Mod dimensionare" value={mode} onChange={(v) => setMode(v as SizingMode)}
        options={(Object.keys(SIZING_MODE_LABEL) as SizingMode[]).map((m) => ({ value: m, label: SIZING_MODE_LABEL[m] }))} />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1" onClick={() => {
          const r = autoSizePipes(mode);
          toast.success(r.pipes || r.valves
            ? `${SIZING_MODE_LABEL[mode]}: ${r.pipes} tronson(e) redimensionate · ${r.valves} vană(e) · rețea recalculată`
            : `Dimensiunile actuale respectă criteriile modului ${SIZING_MODE_LABEL[mode]}.`);
        }}>Aplică recomandarea</Button>
        <Button size="sm" variant="outline" disabled={!sizingUndo || sizingUndo.schemeId !== scheme.id} onClick={() => undoSizing() && toast("DN-urile anterioare au fost restaurate")}>
          <Undo2 className="h-3.5 w-3.5" />Undo
        </Button>
      </div>
    </div>
  );
}

/** Candidați DN pentru conducta selectată. */
export function CandidatesCard({ pipeId, mode, fp }: { pipeId: string | null; mode: SizingMode; fp: FluidProps }) {
  const { scheme, applyPipeDn } = usePid();
  const plan = useMemo(() => planSizing(scheme, fp, { mode, rMax: maxR(scheme) }, 1), [scheme, fp, mode]);
  const sz = pipeId ? plan.sizes.get(pipeId) : undefined;
  return (
    <Card className="mt-4">
      <CardHeader className="pb-3"><CardTitle className="text-sm">Design assistant – candidați DN {sz ? `· ${sz.tag}` : ""}</CardTitle></CardHeader>
      <CardContent className="text-xs">
        {!sz ? <p className="text-muted-foreground">Selectează un rând din tabelul de calcul pentru a vedea candidații DN.</p>
          : sz.status === "skipped" ? <p className="text-muted-foreground">Tronson fără debit sau legătură directă — nu se dimensionează.</p>
          : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>DN</TableHead><TableHead>ID [mm]</TableHead><TableHead>Q [m³/h]</TableHead><TableHead>v [m/s]</TableHead>
                <TableHead>R [Pa/m]</TableHead><TableHead>Δp tronson [kPa]</TableHead><TableHead>Status</TableHead><TableHead>Motiv</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody className="font-mono">
                {sz.candidates.map((c) => (
                  <TableRow key={c.dn} className={c.status === "selected" ? "bg-primary/10" : c.dn === sz.currentDn ? "bg-muted/50" : ""}>
                    <TableCell>{c.dn}{c.dn === sz.currentDn ? " •" : ""}</TableCell>
                    <TableCell>{c.idMm.toFixed(1)}</TableCell>
                    <TableCell>{c.flow.toFixed(2)}</TableCell>
                    <TableCell>{c.v.toFixed(2)}</TableCell>
                    <TableCell>{c.R.toFixed(0)}</TableCell>
                    <TableCell>{(c.dpPipe / 1000).toFixed(2)}</TableCell>
                    <TableCell>{c.status === "selected" ? "recomandat" : c.status === "accepted" ? "acceptat" : "respins"}</TableCell>
                    <TableCell className="font-sans">{c.note}</TableCell>
                    <TableCell>{c.dn !== sz.currentDn && (
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => applyPipeDn(sz.pipeId, c.dn)}>Aplică</Button>
                    )}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        <p className="mt-2 text-[11px] text-muted-foreground">• = DN actual. Debitul provine din solverul de rețea; după aplicare rețeaua se recalculează automat.</p>
      </CardContent>
    </Card>
  );
}

/** Sumar de proiect + Engineering Check prioritizat. */
export function EngineeringCheckCard({ fp, solution, onPick }: { fp: FluidProps; solution: SolverResult; onPick: (id: string) => void }) {
  const { scheme } = usePid();
  const sum = useMemo(() => engineeringCheck(scheme, fp, solution), [scheme, fp, solution]);
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center justify-between text-sm">Engineering Check <LevelBadge level={sum.status} /></CardTitle></CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="grid grid-cols-4 gap-1 text-center font-mono">
          {(["ok", "warning", "incomplete", "unresolved"] as CheckLevel[]).map((l) => (
            <div key={l} className="rounded border px-1 py-1"><div className="text-sm font-semibold">{sum.counts[l]}</div><div className="text-[10px] text-muted-foreground">{l}</div></div>
          ))}
        </div>
        {sum.issues.length === 0 ? <p className="text-muted-foreground">Nicio problemă detectată.</p> : (
          <ul className="max-h-56 space-y-1 overflow-auto">
            {sum.issues.slice(0, 40).map((i, k) => (
              <li key={k}>
                <button className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-muted" onClick={() => i.id && onPick(i.id)}>
                  <LevelBadge level={i.level} /><span><b>{i.tag}</b> — {i.message}{i.deviation ? ` (${i.deviation.toFixed(0)}%)` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
