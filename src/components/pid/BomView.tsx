import { Fragment } from "react";
import { FileSpreadsheet, FileText, FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildBom, exportCsv, exportPdf, exportXlsx } from "@/lib/pid/bom";
import { COUPLING_SPACING } from "@/lib/pid/catalog";
import { usePid } from "@/lib/pid/store";

export function BomView() {
  const scheme = usePid((s) => s.scheme);
  const rows = buildBom(scheme);
  const groups = [...new Set(rows.map((r) => r.group))];
  const run = async (fn: () => unknown, label: string) => {
    try { await fn(); toast.success(`Export ${label} generat`); } catch (e) { console.error(e); toast.error(`Exportul ${label} a eșuat`); }
  };
  const totalLen = rows.filter((r) => r.unit === "m").reduce((s, r) => s + r.qty, 0);

  return (
    <div className="h-full overflow-auto p-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Listă de cantități (BOM / MTO)</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Extrasă automat din schemă · {rows.length} poziții · {totalLen.toFixed(1)} m conductă
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => run(() => exportXlsx(rows, scheme.name), "Excel")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button>
            <Button variant="secondary" onClick={() => run(() => exportPdf(rows, scheme.name), "PDF")}><FileText className="mr-1.5 h-4 w-4" />PDF</Button>
            <Button variant="secondary" onClick={() => run(() => exportCsv(rows, scheme.name), "CSV")}><FileDown className="mr-1.5 h-4 w-4" />CSV</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Articol</TableHead><TableHead>Cod</TableHead><TableHead>Specificație</TableHead>
                <TableHead className="text-right">Cantitate</TableHead><TableHead>UM</TableHead><TableHead>Tag-uri</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40"><TableCell colSpan={6} className="py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">{g.slice(3)}</TableCell></TableRow>
                  {rows.filter((r) => r.group === g).map((r) => (
                    <TableRow key={g + r.item + r.code + r.spec + r.unit}>
                      <TableCell className="font-medium">{r.item}</TableCell>
                      <TableCell className="font-mono text-xs text-primary">{r.code}</TableCell>
                      <TableCell className="text-muted-foreground">{r.spec}</TableCell>
                      <TableCell className="text-right font-mono">{r.unit === "m" ? r.qty.toFixed(1) : r.qty}</TableCell>
                      <TableCell>{r.unit}</TableCell>
                      <TableCell className="max-w-[280px] truncate font-mono text-xs text-muted-foreground" title={r.tags}>{r.tags}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Îmbinările sunt estimate: 2 capete + cuple intermediare la pas de {COUPLING_SPACING} m + 2 îmbinări per fiting.
            Coturile 90° sunt deduse din schimbările de direcție ale traseului, iar cotele de urcare/coborâre se adaugă la metraj.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
