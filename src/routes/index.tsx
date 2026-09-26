import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FilePlus2, RefreshCcw, Tags, Workflow, Gauge, ClipboardList } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PidCanvas } from "@/components/pid/Canvas";
import { Palette } from "@/components/pid/Palette";
import { Inspector } from "@/components/pid/Inspector";
import { HydraulicsView } from "@/components/pid/HydraulicsView";
import { BomView } from "@/components/pid/BomView";
import { usePid } from "@/lib/pid/store";
import { CIRCUITS, type CircuitId } from "@/lib/pid/catalog";
import { FLUID_LABEL, fluidProps } from "@/lib/pid/fluids";
import { computePipe } from "@/lib/pid/hydraulics";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "P&ID Studio — Editor scheme, hidraulică și BOM" },
      { name: "description", content: "Editor P&ID ISA-5.1 cu calcul căderi de presiune Darcy-Weisbach și listă de cantități BOM/MTO exportabilă." },
      { property: "og:title", content: "P&ID Studio — Editor scheme, hidraulică și BOM" },
      { property: "og:description", content: "Scheme P&ID, calcul hidraulic pentru apă și glicol, liste de cantități Excel/PDF." },
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
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const total = scheme.pipes.reduce((s, p) => s + computePipe(p, scheme, fp).dpTotal, 0);
  return (
    <Tabs defaultValue="editor" className="flex h-screen flex-col gap-0">
      <header className="flex items-center gap-4 border-b bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary font-mono text-xs font-bold text-primary-foreground">P&ID</div>
          <Input value={scheme.name} onChange={(e) => setScheme({ name: e.target.value })} className="h-8 w-64 border-transparent bg-transparent font-semibold hover:border-input" />
        </div>
        <TabsList>
          <TabsTrigger value="editor"><Workflow className="mr-1.5 h-4 w-4" />Editor</TabsTrigger>
          <TabsTrigger value="hydro"><Gauge className="mr-1.5 h-4 w-4" />Hidraulică</TabsTrigger>
          <TabsTrigger value="bom"><ClipboardList className="mr-1.5 h-4 w-4" />BOM / MTO</TabsTrigger>
        </TabsList>
        <div className="ml-auto hidden items-center gap-4 font-mono text-xs text-muted-foreground lg:flex">
          <span>{FLUID_LABEL[scheme.fluid]}{scheme.fluid !== "water" && ` ${scheme.concentration}%`} @ {scheme.temperature}°C</span>
          <span>{scheme.nodes.length} elemente · {scheme.pipes.length} segmente</span>
          <span className="text-primary">Δp total {(total / 1000).toFixed(1)} kPa</span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={retag} title="Re-numerotează tag-urile"><Tags className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("Reîncarci schema demo?") && reset()} title="Schemă demo"><RefreshCcw className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("Începi o schemă nouă? Schema curentă va fi ștearsă.") && reset(true)} title="Schemă nouă"><FilePlus2 className="h-4 w-4" /></Button>
        </div>
      </header>
      <TabsContent value="editor" className="mt-0 min-h-0 flex-1">
        <div className="grid h-full grid-cols-[230px_1fr_300px]">
          <Palette />
          <div className="relative min-w-0">
            <PidCanvas />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2 rounded-md border bg-card/90 px-3 py-1.5 text-[11px] backdrop-blur">
              {(Object.keys(CIRCUITS) as CircuitId[]).map((c) => (
                <span key={c} className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: CIRCUITS[c].color }} />{CIRCUITS[c].name}</span>
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
