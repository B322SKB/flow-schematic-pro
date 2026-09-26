import type { ReactNode } from "react";

export type SymbolCategory = "Echipamente" | "Pompe" | "Vane" | "Instrumentație" | "Fitinguri" | "Traseu" | "Personalizate";

export interface SymbolDef {
  type: string;
  name: string;
  category: SymbolCategory;
  prefix: string; // tag prefix (ISA)
  code?: string; // cod scurt afișat pe schemă (RF, RS, CL…)
  w: number;
  h: number;
  ports: { id: string; x: number; y: number }[];
  K?: number; // local resistance when inline
  dpDefault?: number; // kPa
  riser?: "up" | "down"; // urcare / coborâre de conductă
  bomGroup: "Echipamente" | "Vane" | "Instrumente" | "Fitinguri";
  terminal?: boolean; // echipament terminal de răcire (putere sensibilă / totală)
  source?: boolean; // sursă (chiller)
  hasVolume?: boolean; // are volum (litri)
  render: () => ReactNode;
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinejoin: "round" as const };
const inline2 = [{ id: "a", x: 0, y: 20 }, { id: "b", x: 60, y: 20 }];

const bowtie = (extra?: ReactNode, filled = false) => (
  <g>
    <line x1={0} y1={20} x2={12} y2={20} {...S} />
    <line x1={48} y1={20} x2={60} y2={20} {...S} />
    <path d="M12 8 L48 32 L48 8 L12 32 Z" {...S} fill={filled ? "currentColor" : "var(--canvas-bg)"} />
    {extra}
  </g>
);

const boxEquip = (label: string, sub?: string) => (
  <g>
    <rect x={4} y={4} width={92} height={62} rx={4} {...S} fill="var(--canvas-bg)" />
    <text x={50} y={30} textAnchor="middle" fontSize={13} fontWeight={700} fill="currentColor">{label}</text>
    {sub && <text x={50} y={46} textAnchor="middle" fontSize={8} fill="currentColor">{sub}</text>}
    <line x1={0} y1={20} x2={4} y2={20} {...S} />
    <line x1={0} y1={50} x2={4} y2={50} {...S} />
    <line x1={96} y1={20} x2={100} y2={20} {...S} />
    <line x1={96} y1={50} x2={100} y2={50} {...S} />
  </g>
);
const equipPorts4 = [
  { id: "a", x: 0, y: 20 }, { id: "b", x: 0, y: 50 },
  { id: "c", x: 100, y: 20 }, { id: "d", x: 100, y: 50 },
];

const defs = [
  // Pumps
  { type: "pump_centrifugal", name: "Pompă centrifugă", category: "Pompe", prefix: "P", code: "PC", w: 60, h: 60, bomGroup: "Echipamente",
    ports: [{ id: "a", x: 0, y: 30 }, { id: "b", x: 30, y: 0 }], dpDefault: 0,
    render: () => (<g><circle cx={30} cy={30} r={22} {...S} fill="var(--canvas-bg)" /><path d="M30 8 L52 30" {...S} /><path d="M30 8 L8 30" {...S} /><line x1={0} y1={30} x2={8} y2={30} {...S} /><line x1={30} y1={0} x2={30} y2={8} {...S} /><path d="M14 52 L46 52 L40 44 L20 44 Z" {...S} /></g>) },
  { type: "pump_inline", name: "Pompă circulație inline", category: "Pompe", prefix: "P", code: "PI", w: 60, h: 40, bomGroup: "Echipamente", ports: inline2,
    render: () => (<g><line x1={0} y1={20} x2={12} y2={20} {...S} /><line x1={48} y1={20} x2={60} y2={20} {...S} /><circle cx={30} cy={20} r={18} {...S} fill="var(--canvas-bg)" /><path d="M22 10 L40 20 L22 30" {...S} /></g>) },
  { type: "pump_twin", name: "Pompă dublă", category: "Pompe", prefix: "P", code: "PD", w: 60, h: 40, bomGroup: "Echipamente", ports: inline2,
    render: () => (<g><line x1={0} y1={20} x2={6} y2={20} {...S} /><line x1={54} y1={20} x2={60} y2={20} {...S} /><circle cx={19} cy={20} r={13} {...S} fill="var(--canvas-bg)" /><circle cx={41} cy={20} r={13} {...S} fill="var(--canvas-bg)" /><path d="M14 13 L26 20 L14 27" {...S} /><path d="M36 13 L48 20 L36 27" {...S} /></g>) },
  // Equipment
  { type: "chiller", source: true, name: "Chiller", category: "Echipamente", prefix: "CH", code: "CH", w: 120, h: 70, bomGroup: "Echipamente", dpDefault: 45,
    ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 0, y: 50 }, { id: "c", x: 120, y: 20 }, { id: "d", x: 120, y: 50 }],
    render: () => (<g><rect x={4} y={4} width={112} height={62} rx={4} {...S} fill="var(--canvas-bg)" /><path d="M20 35 h80 M30 20 l10 15 -10 15 M90 20 l-10 15 10 15" {...S} strokeWidth={1.5} /><text x={60} y={62} textAnchor="middle" fontSize={9} fill="currentColor">CHILLER</text><line x1={0} y1={20} x2={4} y2={20} {...S} /><line x1={0} y1={50} x2={4} y2={50} {...S} /><line x1={116} y1={20} x2={120} y2={20} {...S} /><line x1={116} y1={50} x2={120} y2={50} {...S} /></g>) },
  { type: "boiler", name: "Cazan", category: "Echipamente", prefix: "B", code: "CZ", w: 70, h: 90, bomGroup: "Echipamente", dpDefault: 15,
    ports: [{ id: "a", x: 35, y: 0 }, { id: "b", x: 35, y: 90 }],
    render: () => (<g><rect x={5} y={5} width={60} height={80} rx={6} {...S} fill="var(--canvas-bg)" /><path d="M25 65 q10 -25 10 -30 q10 15 10 30 z" {...S} /><line x1={35} y1={0} x2={35} y2={5} {...S} /><line x1={35} y1={85} x2={35} y2={90} {...S} /></g>) },
  { type: "hex_plate", name: "Schimbător în plăci", category: "Echipamente", prefix: "HE", code: "SC", w: 60, h: 80, bomGroup: "Echipamente", dpDefault: 25,
    ports: [{ id: "a", x: 0, y: 15 }, { id: "b", x: 0, y: 65 }, { id: "c", x: 60, y: 15 }, { id: "d", x: 60, y: 65 }],
    render: () => (<g><rect x={6} y={4} width={48} height={72} {...S} fill="var(--canvas-bg)" />{[16, 24, 32, 40].map((x) => <line key={x} x1={x} y1={8} x2={x} y2={72} {...S} strokeWidth={1} />)}<path d="M6 76 L54 4" {...S} strokeWidth={1} /><line x1={0} y1={15} x2={6} y2={15} {...S} /><line x1={0} y1={65} x2={6} y2={65} {...S} /><line x1={54} y1={15} x2={60} y2={15} {...S} /><line x1={54} y1={65} x2={60} y2={65} {...S} /></g>) },
  { type: "hex_shell", name: "Schimbător manta-tub", category: "Echipamente", prefix: "HE", code: "SMT", w: 100, h: 50, bomGroup: "Echipamente", dpDefault: 30,
    ports: [{ id: "a", x: 0, y: 25 }, { id: "b", x: 100, y: 25 }, { id: "c", x: 30, y: 0 }, { id: "d", x: 70, y: 50 }],
    render: () => (<g><rect x={8} y={8} width={84} height={34} rx={17} {...S} fill="var(--canvas-bg)" /><path d="M8 25 h14 l8 -10 l10 20 l10 -20 l10 20 l10 -20 l8 10 h14" {...S} strokeWidth={1.5} /><line x1={0} y1={25} x2={8} y2={25} {...S} /><line x1={92} y1={25} x2={100} y2={25} {...S} /><line x1={30} y1={0} x2={30} y2={8} {...S} /><line x1={70} y1={42} x2={70} y2={50} {...S} /></g>) },
  { type: "buffer_tank", hasVolume: true, name: "Rezervor tampon", category: "Echipamente", prefix: "TK", code: "RT", w: 60, h: 110, bomGroup: "Echipamente", dpDefault: 2,
    ports: [{ id: "a", x: 0, y: 25 }, { id: "b", x: 0, y: 85 }, { id: "c", x: 60, y: 25 }, { id: "d", x: 60, y: 85 }],
    render: () => (<g><rect x={6} y={5} width={48} height={100} rx={24} {...S} fill="var(--canvas-bg)" /><line x1={0} y1={25} x2={6} y2={25} {...S} /><line x1={0} y1={85} x2={6} y2={85} {...S} /><line x1={54} y1={25} x2={60} y2={25} {...S} /><line x1={54} y1={85} x2={60} y2={85} {...S} /></g>) },
  { type: "expansion", hasVolume: true, name: "Vas de expansiune", category: "Echipamente", prefix: "EV", code: "VE", w: 50, h: 70, bomGroup: "Echipamente",
    ports: [{ id: "a", x: 25, y: 70 }],
    render: () => (<g><rect x={5} y={5} width={40} height={55} rx={20} {...S} fill="var(--canvas-bg)" /><path d="M5 32 q10 -6 20 0 t20 0" {...S} strokeWidth={1.5} /><line x1={25} y1={60} x2={25} y2={70} {...S} /></g>) },
  { type: "ahu_coil", terminal: true, name: "Baterie răcire/încălzire", category: "Echipamente", prefix: "CL", code: "BR", w: 60, h: 60, bomGroup: "Echipamente", dpDefault: 20,
    ports: [{ id: "a", x: 0, y: 15 }, { id: "b", x: 0, y: 45 }],
    render: () => (<g><rect x={6} y={4} width={50} height={52} {...S} fill="var(--canvas-bg)" /><path d="M6 4 L56 56 M56 4 L6 56" {...S} strokeWidth={1} /><line x1={0} y1={15} x2={6} y2={15} {...S} /><line x1={0} y1={45} x2={6} y2={45} {...S} /></g>) },
  // Data-center cooling equipment
  { type: "ccu", terminal: true, name: "Close Control Unit (CCU)", category: "Echipamente", prefix: "CCU", code: "CCU", w: 100, h: 70, bomGroup: "Echipamente", dpDefault: 35,
    ports: equipPorts4, render: () => boxEquip("CCU", "CLOSE CONTROL") },
  { type: "inrow", terminal: true, name: "Unitate In-Row (IRU)", category: "Echipamente", prefix: "IRU", code: "IRU", w: 100, h: 70, bomGroup: "Echipamente", dpDefault: 30,
    ports: equipPorts4, render: () => boxEquip("IRU", "IN-ROW") },
  { type: "rdhx", terminal: true, name: "Rear Door Heat Exchanger", category: "Echipamente", prefix: "RDHX", code: "RDHX", w: 100, h: 70, bomGroup: "Echipamente", dpDefault: 25,
    ports: equipPorts4, render: () => boxEquip("RDHX", "REAR DOOR HX") },
  { type: "cdu", terminal: true, name: "Cooling Distribution Unit", category: "Echipamente", prefix: "CDU", code: "CDU", w: 100, h: 70, bomGroup: "Echipamente", dpDefault: 60,
    ports: equipPorts4, render: () => boxEquip("CDU", "LIQUID COOLING") },
  { type: "pressure_station", name: "Stație menținere presiune", category: "Echipamente", prefix: "SMP", code: "SMP", w: 60, h: 80, bomGroup: "Echipamente", dpDefault: 0,
    ports: [{ id: "a", x: 30, y: 80 }],
    render: () => (<g><rect x={5} y={5} width={50} height={60} rx={4} {...S} fill="var(--canvas-bg)" /><circle cx={30} cy={26} r={11} {...S} strokeWidth={1.5} /><path d="M30 26 L36 19" {...S} strokeWidth={1.5} /><text x={30} y={56} textAnchor="middle" fontSize={11} fontWeight={700} fill="currentColor">SMP</text><line x1={30} y1={65} x2={30} y2={80} {...S} /></g>) },
  { type: "fill_station", name: "Stație automată de umplere", category: "Echipamente", prefix: "SAU", code: "SAU", w: 60, h: 80, bomGroup: "Echipamente", dpDefault: 0,
    ports: [{ id: "a", x: 30, y: 80 }],
    render: () => (<g><rect x={5} y={5} width={50} height={60} rx={4} {...S} fill="var(--canvas-bg)" /><path d="M30 14 q9 13 9 19 a9 9 0 0 1 -18 0 q0 -6 9 -19 z" {...S} strokeWidth={1.5} /><text x={30} y={58} textAnchor="middle" fontSize={11} fontWeight={700} fill="currentColor">SAU</text><line x1={30} y1={65} x2={30} y2={80} {...S} /></g>) },
  // Valves
  { type: "v_gate", name: "Vană izolare", category: "Vane", prefix: "V", code: "VI", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 0.15, render: () => bowtie() },
  { type: "v_ball", name: "Robinet cu sferă", category: "Vane", prefix: "BV", code: "RS", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 0.05, render: () => bowtie(<circle cx={30} cy={20} r={6} fill="currentColor" />) },
  { type: "v_butterfly", name: "Vană fluture", category: "Vane", prefix: "BFV", code: "RF", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 0.5,
    render: () => bowtie(<g><line x1={30} y1={6} x2={30} y2={34} {...S} /><circle cx={30} cy={20} r={3} fill="currentColor" /></g>) },
  { type: "v_control", name: "Vană de reglaj", category: "Vane", prefix: "CV", code: "VR", w: 60, h: 60, bomGroup: "Vane", K: 6,
    ports: [{ id: "a", x: 0, y: 40 }, { id: "b", x: 60, y: 40 }],
    render: () => (<g transform="translate(0,20)">{bowtie(<g><line x1={30} y1={20} x2={30} y2={-6} {...S} /><path d="M18 -6 a12 12 0 0 1 24 0 z" {...S} fill="var(--canvas-bg)" /></g>)}</g>) },
  { type: "v_motorized", name: "Vană servomotorizată", category: "Vane", prefix: "MV", code: "VS", w: 60, h: 62, bomGroup: "Vane", K: 5,
    ports: [{ id: "a", x: 0, y: 42 }, { id: "b", x: 60, y: 42 }],
    render: () => (<g transform="translate(0,22)">{bowtie(<line x1={30} y1={20} x2={30} y2={-2} {...S} />)}<rect x={16} y={-20} width={28} height={18} rx={3} {...S} fill="var(--canvas-bg)" /><text x={30} y={-7} textAnchor="middle" fontSize={10} fontWeight={700} fill="currentColor">M</text></g>) },
  { type: "v_3way", name: "Vană cu trei căi", category: "Vane", prefix: "MV3", code: "V3C", w: 60, h: 62, bomGroup: "Vane", K: 8,
    ports: [{ id: "a", x: 0, y: 42 }, { id: "b", x: 60, y: 42 }, { id: "c", x: 30, y: 62 }],
    render: () => (<g transform="translate(0,22)"><line x1={0} y1={20} x2={12} y2={20} {...S} /><line x1={48} y1={20} x2={60} y2={20} {...S} /><path d="M12 8 L48 32 L48 8 L12 32 Z" {...S} fill="var(--canvas-bg)" /><path d="M18 40 L42 40 L30 20 Z" {...S} fill="var(--canvas-bg)" /><line x1={30} y1={40} x2={30} y2={40} {...S} /><line x1={30} y1={20} x2={30} y2={-2} {...S} /><rect x={16} y={-20} width={28} height={18} rx={3} {...S} fill="var(--canvas-bg)" /><text x={30} y={-7} textAnchor="middle" fontSize={10} fontWeight={700} fill="currentColor">M</text></g>) },
  { type: "v_balancing", name: "Vană echilibrare", category: "Vane", prefix: "BLV", code: "VE", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 3,
    render: () => bowtie(<path d="M22 36 L38 4 M34 4 h4 v4" {...S} strokeWidth={1.5} />) },
  { type: "v_check", name: "Clapetă de reținere", category: "Vane", prefix: "NRV", code: "CL", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 2,
    render: () => (<g><line x1={0} y1={20} x2={12} y2={20} {...S} /><line x1={48} y1={20} x2={60} y2={20} {...S} /><path d="M12 8 L48 32 L48 8 L12 32 Z" {...S} fill="var(--canvas-bg)" /><path d="M12 8 L12 32 L30 20 Z" fill="currentColor" /></g>) },
  { type: "v_safety", name: "Supapă de siguranță", category: "Vane", prefix: "PSV", code: "SS", w: 50, h: 60, bomGroup: "Vane",
    ports: [{ id: "a", x: 25, y: 60 }],
    render: () => (<g><path d="M13 48 L37 48 L25 28 Z M25 28 L45 18 L45 38 Z" {...S} fill="var(--canvas-bg)" /><path d="M25 28 v-18 m-6 0 l6 -6 l6 6 m-10 4 l8 4 l-8 4 l8 4" {...S} strokeWidth={1.5} /><line x1={25} y1={48} x2={25} y2={60} {...S} /></g>) },
  { type: "strainer", name: "Filtru Y", category: "Vane", prefix: "STR", code: "FY", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 2,
    render: () => (<g><line x1={0} y1={20} x2={60} y2={20} {...S} /><path d="M20 20 L36 36 L42 30 L28 14" {...S} fill="var(--canvas-bg)" /><path d="M24 22 l10 10" {...S} strokeDasharray="2 2" strokeWidth={1} /></g>) },
  { type: "dirt_separator", name: "Separator de nămol / aer", category: "Vane", prefix: "SN", code: "SN", w: 60, h: 64, bomGroup: "Vane", K: 2.5,
    ports: [{ id: "a", x: 0, y: 22 }, { id: "b", x: 60, y: 22 }],
    render: () => (<g><line x1={0} y1={22} x2={14} y2={22} {...S} /><line x1={46} y1={22} x2={60} y2={22} {...S} /><rect x={14} y={6} width={32} height={40} rx={6} {...S} fill="var(--canvas-bg)" /><path d="M20 20 h20 M20 28 h20" {...S} strokeWidth={1} /><path d="M24 46 L36 46 L30 58 Z" {...S} fill="var(--canvas-bg)" /><line x1={30} y1={58} x2={30} y2={64} {...S} /></g>) },
  { type: "antivib", name: "Racord antivibrant", category: "Fitinguri", prefix: "RA", code: "RA", w: 60, h: 40, bomGroup: "Fitinguri", ports: inline2, K: 0.6,
    render: () => (<g><line x1={0} y1={20} x2={14} y2={20} {...S} /><line x1={46} y1={20} x2={60} y2={20} {...S} /><line x1={14} y1={8} x2={14} y2={32} {...S} /><line x1={46} y1={8} x2={46} y2={32} {...S} /><path d="M14 20 q4 -12 8 0 t8 0 t8 0 t8 0" {...S} strokeWidth={1.5} /></g>) },
  // Instruments (ISA bubble)
  ...([
    ["i_pg", "Manometru", "PI"], ["i_ps", "Presostat", "PS"], ["i_pt", "Traductor presiune", "PT"],
    ["i_ti", "Termometru", "TI"], ["i_tt", "Senzor temperatură", "TT"], ["i_ft", "Debitmetru", "FT"],
    ["i_fs", "Fluxostat", "FS"], ["i_dpt", "Traductor Δp", "PDT"],
  ] as const).map(([type, name, prefix]) => ({
    type, name, category: "Instrumentație" as const, prefix, w: 44, h: 60, bomGroup: "Instrumente" as const,
    ports: [{ id: "a", x: 22, y: 60 }],
    render: () => (<g><circle cx={22} cy={22} r={18} {...S} fill="var(--canvas-bg)" /><line x1={4} y1={22} x2={40} y2={22} {...S} strokeWidth={1} /><text x={22} y={18} textAnchor="middle" fontSize={10} fontWeight={600} fill="currentColor">{prefix}</text><line x1={22} y1={40} x2={22} y2={60} {...S} strokeDasharray="3 2" /></g>),
  })),
  { type: "i_flowmeter_inline", name: "Debitmetru inline", category: "Instrumentație", prefix: "FE", code: "FE", w: 60, h: 40, bomGroup: "Instrumente", ports: inline2, K: 0.2,
    render: () => (<g><line x1={0} y1={20} x2={60} y2={20} {...S} /><rect x={16} y={8} width={28} height={24} {...S} fill="var(--canvas-bg)" /><text x={30} y={24} textAnchor="middle" fontSize={10} fill="currentColor">FE</text></g>) },
  // Fittings
  { type: "tee", name: "Teu", category: "Fitinguri", prefix: "T", code: "TE", w: 40, h: 40, bomGroup: "Fitinguri", K: 0.4,
    ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 40, y: 20 }, { id: "c", x: 20, y: 40 }],
    render: () => (<g><line x1={0} y1={20} x2={40} y2={20} {...S} /><line x1={20} y1={20} x2={20} y2={40} {...S} /><circle cx={20} cy={20} r={3} fill="currentColor" /></g>) },
  { type: "reducer", name: "Reducție", category: "Fitinguri", prefix: "R", code: "RD", w: 40, h: 40, bomGroup: "Fitinguri", ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 40, y: 20 }], K: 0.3,
    render: () => (<g><path d="M0 20 h8 M32 20 h8 M8 8 L32 14 L32 26 L8 32 Z" {...S} fill="var(--canvas-bg)" /></g>) },
  { type: "air_vent", name: "Aerisitor automat", category: "Fitinguri", prefix: "AV", code: "AA", w: 30, h: 40, bomGroup: "Fitinguri", ports: [{ id: "a", x: 15, y: 40 }],
    render: () => (<g><rect x={5} y={6} width={20} height={20} rx={3} {...S} fill="var(--canvas-bg)" /><path d="M15 6 v-5" {...S} /><line x1={15} y1={26} x2={15} y2={40} {...S} /></g>) },
  { type: "drain", name: "Golire / drenaj", category: "Fitinguri", prefix: "DR", code: "GD", w: 30, h: 40, bomGroup: "Fitinguri", ports: [{ id: "a", x: 15, y: 0 }],
    render: () => (<g><line x1={15} y1={0} x2={15} y2={20} {...S} /><path d="M5 20 L25 20 L15 34 Z" {...S} fill="var(--canvas-bg)" /></g>) },
  // Riser up / down
  { type: "riser_up", name: "Urcare conductă", category: "Traseu", prefix: "URC", code: "URC", w: 40, h: 40, bomGroup: "Fitinguri", riser: "up", K: 0.9,
    ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 40, y: 20 }],
    render: () => (<g><line x1={0} y1={20} x2={9} y2={20} {...S} /><line x1={31} y1={20} x2={40} y2={20} {...S} /><circle cx={20} cy={20} r={11} {...S} fill="var(--canvas-bg)" /><circle cx={20} cy={20} r={4} fill="currentColor" /></g>) },
  { type: "riser_down", name: "Coborâre conductă", category: "Traseu", prefix: "COB", code: "COB", w: 40, h: 40, bomGroup: "Fitinguri", riser: "down", K: 0.9,
    ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 40, y: 20 }],
    render: () => (<g><line x1={0} y1={20} x2={9} y2={20} {...S} /><line x1={31} y1={20} x2={40} y2={20} {...S} /><circle cx={20} cy={20} r={11} {...S} fill="var(--canvas-bg)" /><path d="M13 13 L27 27 M27 13 L13 27" {...S} strokeWidth={1.5} /></g>) },
] satisfies SymbolDef[];

export type SymbolType = string;
/** Scară de desen pe categorie: echipamentele mai mari decât vanele/fitingurile. */
const SCALE: Partial<Record<SymbolCategory, number>> = { Echipamente: 1.5, Vane: 0.75, Fitinguri: 0.75, "Instrumentație": 0.8, Traseu: 0.75 };

/** Scalează simbolul păstrând porturile pe grila de 5 (relativ la centru) pentru trasee drepte. */
function scaled(d: SymbolDef): SymbolDef {
  const k = SCALE[d.category] ?? 1;
  if (k === 1) return d;
  const w = Math.max(20, Math.round((d.w * k) / 10) * 10);
  const h = Math.max(20, Math.round((d.h * k) / 10) * 10);
  const kx = w / d.w, ky = h / d.h;
  const r5 = (v: number) => Math.round(v / 5) * 5;
  const ports = d.ports.map((p) => ({ ...p, x: r5((p.x - d.w / 2) * kx) + w / 2, y: r5((p.y - d.h / 2) * ky) + h / 2 }));
  const r = d.render;
  return { ...d, w, h, ports, render: () => <g transform={`scale(${kx} ${ky})`}>{r()}</g> };
}

const scaledDefs: SymbolDef[] = (defs as SymbolDef[]).map(scaled);
export const SYMBOLS = Object.fromEntries(scaledDefs.map((d) => [d.type, d])) as Record<string, SymbolDef>;
export const SYMBOL_LIST: SymbolDef[] = scaledDefs;

/** Simbol definit de utilizator, salvat în proiect. */
export interface CustomSymbol {
  id: string;
  name: string;
  code: string;
  prefix: string;
  ports: number; // 1..4
  category: "Echipamente" | "Vane" | "Fitinguri";
  dpDefault?: number | undefined;
  kw?: number | undefined;
  K?: number | undefined;
  image?: string | undefined; // desen propriu (data URL SVG/PNG/JPG)
}

const CUSTOM_PORTS: Record<number, { id: string; x: number; y: number }[]> = {
  1: [{ id: "a", x: 0, y: 30 }],
  2: [{ id: "a", x: 0, y: 30 }, { id: "b", x: 100, y: 30 }],
  3: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 100, y: 20 }, { id: "c", x: 50, y: 60 }],
  4: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 0, y: 44 }, { id: "c", x: 100, y: 20 }, { id: "d", x: 100, y: 44 }],
};

export function customSymbolDef(c: CustomSymbol): SymbolDef {
  const ports = CUSTOM_PORTS[Math.min(4, Math.max(1, c.ports))]!;
  return {
    type: `custom:${c.id}`,
    name: c.name,
    category: "Personalizate",
    prefix: c.prefix || "X",
    code: c.code,
    w: 100,
    h: 60,
    ports,
    bomGroup: c.category === "Vane" ? "Vane" : c.category === "Fitinguri" ? "Fitinguri" : "Echipamente",
    ...(c.dpDefault !== undefined ? { dpDefault: c.dpDefault } : {}),
    ...(c.K !== undefined ? { K: c.K } : {}),
    render: () => (
      <g>
        {c.image ? (
          <>
            <rect x={4} y={4} width={92} height={52} rx={4} fill="var(--canvas-bg)" />
            <image href={c.image} x={6} y={6} width={88} height={48} preserveAspectRatio="xMidYMid meet" />
          </>
        ) : (
          <>
            <rect x={4} y={4} width={92} height={52} rx={4} {...S} fill="var(--canvas-bg)" strokeDasharray="6 3" />
            <text x={50} y={27} textAnchor="middle" fontSize={12} fontWeight={700} fill="currentColor">{c.code || c.prefix}</text>
            <text x={50} y={43} textAnchor="middle" fontSize={7} fill="currentColor">{c.name.slice(0, 22).toUpperCase()}</text>
          </>
        )}
        {ports.map((p) => (
          <line key={p.id} x1={p.x < 50 ? 0 : 96} y1={p.y} x2={p.x < 50 ? 4 : 100} y2={p.y} {...S} />
        ))}
      </g>
    ),
  };
}

const CUSTOM_REGISTRY: Record<string, SymbolDef> = {};

/** Menține registrul de simboluri personalizate pentru căutarea după tip. */
export function syncCustomSymbols(list: CustomSymbol[]) {
  for (const k of Object.keys(CUSTOM_REGISTRY)) delete CUSTOM_REGISTRY[k];
  for (const c of list) CUSTOM_REGISTRY[`custom:${c.id}`] = customSymbolDef(c);
}

const FALLBACK: SymbolDef = {
  type: "unknown", name: "Element necunoscut", category: "Personalizate", prefix: "X", code: "?",
  w: 60, h: 40, ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 60, y: 20 }], bomGroup: "Fitinguri",
  render: () => (<g><rect x={4} y={4} width={52} height={32} {...S} strokeDasharray="4 3" fill="var(--canvas-bg)" /><text x={30} y={25} textAnchor="middle" fontSize={12} fill="currentColor">?</text></g>),
};

export function getSymbol(type: string): SymbolDef {
  return SYMBOLS[type] ?? CUSTOM_REGISTRY[type] ?? FALLBACK;
}
