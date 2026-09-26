# P&ID Flow Pro

Creează o platformă completă pentru realizarea de scheme P&ID (Piping and Instrumentation Diagram) cu editor vizual interactiv, generare automată de liste de cantități (BOM / MTO) și modul integrat de calcul al căderilor de presiune (hidraulică).

Specificații cheie:
1. Editor Canvas P&ID:
- Bibliotecă bogată de simboluri conform ISA-5.1 / ISO 10628: pompe (circulare, centrifuge etc.), chillere, schimbătoare de căldură, rezervoare tampon/vas expansiune, cazane, vane (fluture, sferă, reglaj, reținere, siguranță), instrumentație (presostate, manometre, senzori temperatură, debitmetre).
- Sistem de trasare conducte cu snap la porturi, direcție de curgere (săgeți), culori după mediu/circuit (tur, retur, glycol, etc.), etichetare automată (tagging).
- Selectare diametru nominal (DN15 până la DN300+) și tip de conductă direct pe segmente.

2. Baza de date materiale & tehnologii de îmbinare:
- Conducte din plastic: Georg Fischer Cool-Fit 2.0 și Cool-Fit 4.0 (preizolate, rugozitate specifică PE100, diametre DN/d).
- Conducte din oțel (carbon / inox): îmbinări filetate (DN mici), îmbinări sudate, flanșate și îmbinări cu cuple rapide canelate (tip Victaulic / grooved) pentru diametre mari.
- Catalog de fitinguri asociate pentru calculul pierderilor locale (coturi 90°/45°, teuri de trecere/ramificație, reduceri, vane deschise/parțial închise, clapete).

3. Modul de calcul hidraulic (Cădere de presiune):
- Fluide de lucru selectabile:
  * Apă curată
  * Soluție Etilenglicol (concentrație 0 - 60%)
  * Soluție Propilenglicol (concentrație 0 - 60%)
- Selector temperatură fluid (-20°C la +90°C) cu calcul automat al densității (ρ) și vâscozității cinematice/dinamice (μ).
- Calcul căderi de presiune bazat pe ecuația Darcy-Weisbach și Colebrook-White: căderi liniare (pe metru liniar de țeavă) + căderi locale (rezistențe locale fitinguri/vane K).
- Afișare rezultate pe segment și pe circuit complet: debit (m³/h sau l/s), viteză de curgere (m/s) cu atenționare la viteze prea mari/mici, regim curgere (Re - laminar/turbulent), pierdere de presiune (kPa, bar sau mCA).

4. Listă de cantități (BOM / MTO):
- Extragere automată a tuturor componentelor din schemă: lungimi totale de țeavă pe fiecare DN și tip (GF Cool-Fit, Oțel), număr și tip de vane, fitinguri deduse din traseu, instrumente și echipamente.
- Posibilitate de exportare a listei în format Excel (XLSX) și PDF/CSV.
- Interfață modernă, tehnică, clară și intuitivă (shadcn/ui, Tailwind).

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pnp-diagrams.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8fc19e84-7313-4722-b46b-0bcb4cf5648b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
