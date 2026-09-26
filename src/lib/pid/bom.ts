import { FITTINGS, getMaterial, JOINT_LABEL, sizeLabel, type FittingId } from "./catalog";
import { autoBends } from "./hydraulics";
import { SYMBOLS } from "./symbols";
import type { Scheme } from "./types";

export interface BomRow {
  group: string;
  item: string;
  spec: string;
  qty: number;
  unit: string;
  tags: string;
}

export function buildBom(scheme: Scheme): BomRow[] {
  const map = new Map<string, BomRow>();
  const add = (group: string, item: string, spec: string, qty: number, unit: string, tag?: string) => {
    const key = `${group}|${item}|${spec}|${unit}`;
    const r = map.get(key) ?? { group, item, spec, qty: 0, unit, tags: "" };
    r.qty += qty;
    if (tag) r.tags = r.tags ? `${r.tags}, ${tag}` : tag;
    map.set(key, r);
  };

  for (const p of scheme.pipes) {
    const m = getMaterial(p.material);
    const size = sizeLabel(p.material, p.dn);
    const jl = JOINT_LABEL[p.joint];
    add("1. Conducte", `Țeavă ${m.short}`, `${size} · ${jl}`, p.length, "m", p.tag);
    const bends = autoBends(p, scheme);
    const fits: Partial<Record<FittingId, number>> = { ...p.fittings };
    fits.elbow90 = (fits.elbow90 ?? 0) + bends;
    let fittingCount = 0;
    for (const [k, n] of Object.entries(fits)) {
      if (!n) continue;
      fittingCount += n;
      add("2. Fitinguri", FITTINGS[k as FittingId].name, `${m.short} ${size} · ${jl}`, n, "buc");
    }
    // joints estimation: 2 ends + intermediate bar joints + 2 per fitting
    const bar = p.material.startsWith("cf") ? 12 : 6;
    const joints = 2 + Math.max(0, Math.ceil(p.length / bar) - 1) + fittingCount * 2;
    const jointItem =
      p.joint === "grooved" ? "Cuplă canelată (Victaulic)" :
      p.joint === "flanged" ? "Set flanșe + garnitură + șuruburi" :
      p.joint === "welded" ? "Sudură cap la cap" :
      p.joint === "threaded" ? "Îmbinare filetată (mufă/racord)" : "Manșon electrofuziune";
    add("3. Îmbinări", jointItem, `${m.short} ${size}`, joints, p.joint === "welded" ? "sudură" : "buc");
  }

  for (const n of scheme.nodes) {
    const s = SYMBOLS[n.type];
    const pipe = scheme.pipes.find((p) => p.from.node === n.id || p.to.node === n.id);
    const dn = n.dn ?? pipe?.dn;
    const spec = s.bomGroup === "Echipamente" ? (n.note || "conform fișă tehnică") : dn ? `DN${dn}` : "—";
    const grp = s.bomGroup === "Echipamente" ? "4. Echipamente" : s.bomGroup === "Vane" ? "5. Vane" : s.bomGroup === "Instrumente" ? "6. Instrumente" : "2. Fitinguri";
    add(grp, s.name, spec, 1, "buc", n.tag);
  }

  return [...map.values()]
    .map((r) => ({ ...r, qty: r.unit === "m" ? Math.round(r.qty * 10) / 10 : r.qty }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.item.localeCompare(b.item) || a.spec.localeCompare(b.spec, undefined, { numeric: true }));
}

const HEAD = ["Grupă", "Articol", "Specificație", "Cantitate", "UM", "Tag-uri"];
const rowArr = (r: BomRow) => [r.group, r.item, r.spec, r.qty, r.unit, r.tags];

export async function exportXlsx(rows: BomRow[], name: string) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows.map(rowArr)]);
  ws["!cols"] = [{ wch: 16 }, { wch: 32 }, { wch: 44 }, { wch: 10 }, { wch: 8 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BOM-MTO");
  XLSX.writeFile(wb, `${slug(name)}-BOM.xlsx`);
}

export function exportCsv(rows: BomRow[], name: string) {
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [HEAD, ...rows.map(rowArr)].map((r) => r.map(esc).join(";")).join("\n");
  download(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `${slug(name)}-BOM.csv`);
}

const ascii = (s: string) =>
  s.replace(/[șş]/g, "s").replace(/[ȘŞ]/g, "S").replace(/[țţ]/g, "t").replace(/[ȚŢ]/g, "T")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/°/g, " grd").replace(/·/g, "-");

export async function exportPdf(rows: BomRow[], name: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(ascii(`Lista de cantitati (BOM / MTO) - ${name}`), 14, 15);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleDateString("ro-RO"), 14, 21);
  autoTable(doc, {
    startY: 26,
    head: [HEAD.map(ascii)],
    body: rows.map((r) => rowArr(r).map((v) => ascii(String(v)))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  doc.save(`${slug(name)}-BOM.pdf`);
}

function slug(s: string) { return ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "schema"; }
function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
