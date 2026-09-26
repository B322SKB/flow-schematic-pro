import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, RefreshCcw, Tags, Workflow, Gauge, ClipboardList, FileText, Image as ImageIcon, FileCode2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PidCanvas } from "@/components/pid/Canvas";
import { Palette } from "@/components/pid/Palette";
import { Inspector } from "@/components/pid/Inspector";
import { HydraulicsView } from "@/components/pid/HydraulicsView";
import { BomView } from "@/components/pid/BomView";
import { ColorsDialog, ProjectsDialog, SystemDialog } from "@/components/pid/Dialogs";
import { usePid } from "@/lib/pid/store";
import { CIRCUITS, CIRCUIT_IDS, circuitColor } from "@/lib/pid/catalog";
import { fluidProps } from "@/lib/pid/fluids";
import { computePipe } from "@/lib/pid/hydraulics";
import { exportSchemePdf, exportSchemePng, exportSchemeSvg } from "@/lib/pid/export";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "P&ID Studio — Editor scheme, hidraulică și BOM" },
      { name: "description", content: "Editor P&ID ISA-5.1 cu calcul căderi de presiune Darcy-Weisbach și listă de cantități BOM/MTO exportabilă." },
      { property: "og:title", content: "P&ID Studio — Editor scheme, hidraulică și BOM" },
      { property: "og:description", content: "Scheme P&ID, calcul hidraulic pentru apă și glicol, liste de cantități Excel/PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div className="flex h-screen items-center justify-center font-mono text-sm text-muted-foreground">Se încarcă P&ID Studio…</div>;
  return <App />;
}

function App() {
  const { scheme, setScheme, reset, retag } = usePid();
  const svgRef = useRef<SVGSVGElement>(null);
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const results = scheme.pipes.map((p) => computePipe(p, scheme, fp));
  const total = results.reduce((s, r) => s + r.dpTotal, 0);
  const stats = {
    dpTotal: total / 1000,
    flowMax: scheme.pipes.reduce((m, p) => Math.max(m, p.flow), 0),
    lengthTotal: results.reduce((s, r) => s + r.L, 0),
  };
  const run = async (fn: () => unknown, label: string) => {
    try { await fn(); toast.success(`${label} generat`); } catch (e) { console.error(e); toast.error(`${label} nu a putut fi generat`); }
  };

  return (
    <Tabs defaultValue="editor" className="flex h-screen flex-col gap-0">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary font-mono text-xs font-bold text-primary-foreground">P&ID</div>
          <Input value={scheme.name} onChange={(e) => setScheme({ name: e.target.value })} className="h-8 w-52 border-transparent bg-transparent font-semibold hover:border-input" />
          <Input value={scheme.revision} onChange={(e) => setScheme({ revision: e.target.value })} className="h-8 w-16 font-mono text-xs" title="Revizie" />
        </div>
        <TabsList>
          <TabsTrigger value="editor"><Workflow className="mr-1.5 h-4 w-4" />Editor</TabsTrigger>
          <TabsTrigger value="hydro"><Gauge className="mr-1.5 h-4 w-4" />Hidraulică</TabsTrigger>
          <TabsTrigger value="bom"><ClipboardList className="mr-1.5 h-4 w-4" />BOM / MTO</TabsTrigger>
        </TabsList>
        <SystemDialog />
        <div className="ml-auto hidden items-center gap-4 font-mono text-xs text-muted-foreground xl:flex">
          <span>{scheme.nodes.length} elemente · {scheme.pipes.length} segmente · {stats.lengthTotal.toFixed(1)} m</span>
          <span className="text-primary">Δp total {stats.dpTotal.toFixed(1)} kPa</span>
        </div>
        <div className="flex gap-1">
          <ProjectsDialog />
          <ColorsDialog />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5"><FileText className="h-4 w-4" />Export schemă</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => svgRef.current && run(() => exportSchemePdf(svgRef.current!, scheme, stats), "PDF cu cartuș și legendă")}>
                <FileText className="mr-2 h-4 w-4" />PDF A3 cu legendă și cartuș
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => svgRef.current && run(() => exportSchemePng(svgRef.current!, scheme.name), "PNG")}>
                <ImageIcon className="mr-2 h-4 w-4" />Imagine PNG (înaltă rezoluție)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => svgRef.current && run(() => exportSchemeSvg(svgRef.current!, scheme.name), "SVG")}>
                <FileCode2 className="mr-2 h-4 w-4" />Desen vectorial SVG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={retag} title="Re-numerotează tag-urile"><Tags className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("Reîncarci schema demo în acest proiect?") && reset()} title="Schemă demo"><RefreshCcw className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("Golești schema din acest proiect?") && reset(true)} title="Golește schema"><FilePlus2 className="h-4 w-4" /></Button>
        </div>
      </header>
      <TabsContent value="editor" className="mt-0 min-h-0 flex-1">
        <div className="grid h-full grid-cols-[230px_1fr_310px]">
          <Palette />
          <div className="relative min-w-0">
            <PidCanvas svgRef={svgRef} />
            <div className="pointer-events-none absolute left-3 top-3 flex max-w-[60%] flex-wrap gap-2 rounded-md border bg-card/90 px-3 py-1.5 text-[11px] backdrop-blur">
              {CIRCUIT_IDS.map((c) => (
                <span key={c} className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: circuitColor(scheme, c) }} />{CIRCUITS[c].name}</span>
              ))}
            </div>
          </div>
          <Inspector />
        </div>
      </TabsContent>
      <TabsContent value="hydro" className="mt-0 min-h-0 flex-1"><HydraulicsView /></TabsContent>
      <TabsContent value="bom" className="mt-0 min-h-0 flex-1"><BomView /></TabsContent>
    </Tabs>
  );
}
