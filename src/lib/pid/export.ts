import { CIRCUIT_IDS, CIRCUITS, circuitColor, type CircuitId } from "./catalog";
import { FLUID_LABEL, fluidProps } from "./fluids";
import { getSymbol } from "./symbols";
import { computePipe, circuitTotals } from "./hydraulics";
import { getMaterial, sizeLabel } from "./catalog";
import { pipePower, powerTotals } from "./power";
import type { Scheme } from "./types";

export const ascii = (s: string) =>
  s.replace(/[șş]/g, "s").replace(/[ȘŞ]/g, "S").replace(/[țţ]/g, "t").replace(/[ȚŢ]/g, "T")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/°/g, " grd").replace(/·/g, "-")
    .replace(/Δ/g, "d").replace(/³/g, "3").replace(/²/g, "2").replace(/μ/g, "u").replace(/ρ/g, "rho").replace(/λ/g, "lambda");

export function slug(s: string) {
  return ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "schema";
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Înlocuiește variabilele CSS cu valori concrete, ca desenul să fie valid în afara paginii. */
function resolveVars(root: Element) {
  const cs = getComputedStyle(document.documentElement);
  const val = (name: string) => cs.getPropertyValue(name).trim() || "#0f172a";
  const fix = (v: string) => v.replace(/var\((--[a-z0-9-]+)\)/gi, (_, n: string) => val(n));
  const ink = val("--canvas-ink") || "#dbeafe";
  root.querySelectorAll<SVGElement>("*").forEach((el) => {
    for (const attr of ["fill", "stroke"]) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      if (v.includes("var(")) el.setAttribute(attr, fix(v));
      else if (v === "currentColor") el.setAttribute(attr, ink);
    }
    const style = el.getAttribute("style");
    if (style?.includes("var(")) el.setAttribute("style", fix(style));
  });
  (root as SVGElement).style.color = ink;
}

/** Construiește un SVG autonom cu întregul desen, decupat pe conținut. */
export function schemeSvgString(svg: SVGSVGElement, pad = 40) {
  const content = svg.querySelector<SVGGElement>("#pid-content");
  if (!content) return null;
  const box = content.getBBox();
  const w = Math.max(200, box.width + pad * 2);
  const h = Math.max(150, box.height + pad * 2);
  const clone = content.cloneNode(true) as SVGGElement;
  clone.removeAttribute("transform");
  resolveVars(clone);
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim() || "#0b1220";
  const wrap = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wrap.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  wrap.setAttribute("width", String(Math.round(w)));
  wrap.setAttribute("height", String(Math.round(h)));
  wrap.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${w} ${h}`);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(box.x - pad));
  rect.setAttribute("y", String(box.y - pad));
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  rect.setAttribute("fill", bg);
  wrap.appendChild(rect);
  wrap.appendChild(clone);
  return { markup: new XMLSerializer().serializeToString(wrap), width: w, height: h, bg };
}

export function exportSchemeSvg(svg: SVGSVGElement, name: string) {
  const out = schemeSvgString(svg);
  if (!out) return;
  download(new Blob([out.markup], { type: "image/svg+xml;charset=utf-8" }), `${slug(name)}-schema.svg`);
}

async function rasterize(markup: string, w: number, h: number, scale: number, bg: string) {
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("render"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/png");
}

export async function exportSchemePng(svg: SVGSVGElement, name: string) {
  const out = schemeSvgString(svg);
  if (!out) return;
  const url = await rasterize(out.markup, out.width, out.height, 3, out.bg);
  const blob = await (await fetch(url)).blob();
  download(blob, `${slug(name)}-schema.png`);
}

export interface SchemeStats {
  dpTotal: number; // kPa
  flowMax: number; // m3/h
  lengthTotal: number; // m
}

/** PDF A3 landscape cu desenul, legenda de culori/simboluri și cartușul tehnic. */
export async function exportSchemePdf(svg: SVGSVGElement, scheme: Scheme, stats: SchemeStats) {
  const out = schemeSvgString(svg);
  if (!out) return;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const W = 420, H = 297, M = 8;
  const png = await rasterize(out.markup, out.width, out.height, 2.5, out.bg);

  // cadru general
  doc.setDrawColor(40);
  doc.setLineWidth(0.6);
  doc.rect(M, M, W - 2 * M, H - 2 * M);

  // zona desen
  const dx = M + 2, dy = M + 2, dw = W - 2 * M - 4, dh = 205;
  const k = Math.min(dw / out.width, dh / out.height);
  const iw = out.width * k, ih = out.height * k;
  doc.addImage(png, "PNG", dx + (dw - iw) / 2, dy + (dh - ih) / 2, iw, ih);
  doc.setDrawColor(150);
  doc.setLineWidth(0.2);
  doc.rect(dx, dy, dw, dh);

  const baseY = dy + dh + 4;

  // legenda circuitelor
  doc.setLineWidth(0.3);
  doc.setDrawColor(40);
  doc.rect(M + 2, baseY, 120, 66);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("LEGENDA CIRCUITE", M + 5, baseY + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const used = new Set(scheme.pipes.map((p) => p.circuit));
  let ly = baseY + 12;
  for (const c of CIRCUIT_IDS.filter((c) => used.has(c) || scheme.pipes.length === 0)) {
    doc.setDrawColor(circuitColor(scheme, c));
    doc.setLineWidth(1.4);
    doc.line(M + 5, ly - 1, M + 17, ly - 1);
    doc.setTextColor(30);
    doc.text(ascii(CIRCUITS[c as CircuitId].name), M + 20, ly);
    ly += 6;
  }

  // legenda simbolurilor folosite
  doc.setDrawColor(40);
  doc.setLineWidth(0.3);
  doc.rect(M + 126, baseY, 150, 66);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("LEGENDA SIMBOLURI", M + 129, baseY + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const kinds = new Map<string, string>();
  for (const n of scheme.nodes) {
    const s = getSymbol(n.type);
    kinds.set(s.type, `${s.code ?? s.prefix} — ${s.name}`);
  }
  const items = [...kinds.values()].sort();
  const half = Math.ceil(items.length / 2) || 1;
  items.forEach((t, i) => {
    const col = i < half ? 0 : 1;
    const row = i % half;
    doc.text(ascii(t).slice(0, 38), M + 129 + col * 74, baseY + 12 + row * 4.6);
  });

  // cartuș tehnic
  const cx = M + 280, cw = W - 2 * M - 282;
  doc.setLineWidth(0.4);
  doc.rect(cx, baseY, cw, 66);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(ascii(scheme.name).slice(0, 34), cx + 3, baseY + 8);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const rows: [string, string][] = [
    ["Tip plansa", "Schema P&ID - instalatie hidraulica"],
    ["Fluid", `${FLUID_LABEL[scheme.fluid]}${scheme.fluid !== "water" ? ` ${scheme.concentration}%` : ""}`],
    ["Regim", `${scheme.temperature} grd C / dT ${scheme.deltaT} K`],
    ["Densitate / visc.", `${fp.rho.toFixed(0)} kg/m3 / ${(fp.mu * 1000).toFixed(2)} mPa-s`],
    ["Lungime totala", `${stats.lengthTotal.toFixed(1)} m`],
    ["Debit maxim", `${stats.flowMax.toFixed(1)} m3/h`],
    ["dP total circuit", `${stats.dpTotal.toFixed(1)} kPa`],
    ["Revizie / data", `${scheme.revision} / ${new Date().toLocaleDateString("ro-RO")}`],
  ];
  rows.forEach(([k, v], i) => {
    const y = baseY + 15 + i * 6.2;
    doc.setTextColor(110);
    doc.text(ascii(k), cx + 3, y);
    doc.setTextColor(20);
    doc.text(ascii(v).slice(0, 40), cx + 38, y);
  });
  doc.setFontSize(6.5);
  doc.setTextColor(130);
  doc.text("Generat cu P&ID Studio - calcul Darcy-Weisbach / Colebrook-White", cx + 3, baseY + 63);

  // pagina 2+: calculul hidraulic aferent desenului
  const autoTable = (await import("jspdf-autotable")).default;
  doc.addPage("a3", "landscape");
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(ascii(`Calcul hidraulic - ${scheme.name}`), M + 4, M + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const pw = powerTotals(scheme);
  doc.text(ascii(`Fluid: ${FLUID_LABEL[scheme.fluid]}${scheme.fluid !== "water" ? ` ${scheme.concentration}%` : ""} la ${scheme.temperature} grd C · rho ${fp.rho.toFixed(1)} kg/m3 · nu ${(fp.nu * 1e6).toFixed(3)} mm2/s`), M + 4, M + 17);
  doc.text(ascii(`Putere sensibila instalata ${pw.sensInstalled.toFixed(1)} kW · Putere sensibila activa ${pw.sensActive.toFixed(1)} kW · Putere necesara ${pw.required.toFixed(1)} kW · Putere furnizata ${pw.supplied.toFixed(1)} kW${pw.deficit ? " (INSUFICIENTA)" : ""}`), M + 4, M + 23);
  const off = scheme.pipes.filter((p) => p.disabled).map((p) => p.tag);
  if (off.length) doc.text(ascii(`Tronsoane scoase din functiune (scenariu inel): ${off.join(", ")}`), M + 4, M + 29);
  const active = scheme.pipes.filter((p) => !p.disabled);
  autoTable(doc, {
    startY: M + 33,
    head: [["Tag", "Material / DN", "L [m]", "Q [m3/h]", "P [kW]", "v [m/s]", "Re", "lambda", "R [Pa/m]", "Suma K", "dp lin [kPa]", "dp loc [kPa]", "dp elem [kPa]", "dp total [kPa]"]],
    body: active.map((p) => {
      const r = computePipe(p, scheme, fp);
      return [p.tag + (p.direct ? " (direct)" : ""), ascii(`${getMaterial(p.material).short} ${sizeLabel(p.material, p.dn)}`), r.L.toFixed(1), p.flow.toFixed(2),
        pipePower(p, scheme, fp).toFixed(1), r.v.toFixed(2) + (r.velWarn ? " !" : ""), Math.round(r.Re).toString(), r.f.toFixed(4), r.R.toFixed(0), r.Ksum.toFixed(2),
        (r.dpLin / 1000).toFixed(2), (r.dpLoc / 1000).toFixed(2), (r.dpComp / 1000).toFixed(2), (r.dpTotal / 1000).toFixed(2)];
    }),
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  const tot = circuitTotals(scheme, fp);
  autoTable(doc, {
    head: [["Circuit", "Segmente", "Lungime [m]", "dp [kPa]"]],
    body: [...tot.entries()].map(([c, v]) => [ascii(CIRCUITS[c].name), String(v.n), v.L.toFixed(1), (v.dp / 1000).toFixed(2)]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    tableWidth: 160,
  });

  doc.save(`${slug(scheme.name)}-schema.pdf`);
}

export function exportProjectFile(scheme: Scheme) {
  download(new Blob([JSON.stringify(scheme, null, 2)], { type: "application/json" }), `${slug(scheme.name)}.pid.json`);
}
