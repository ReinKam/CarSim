# CarSim – kjøretrener for førerkort klasse B

Nettleserbasert bilsimulator for øvingskjøring. Simulatoren kjører lokalt i nettleseren
(ingen server, ingen installasjon) og bruker ekte veier fra OpenStreetMap.

**Status: prototype 0.1 (fase 0).** Dette er en første teknisk test, ikke et ferdig
opplæringsverktøy. Vurderingen er veiledende og erstatter ikke opplæring ved trafikkskole.

## Prøv den

- På nett: <https://reinkam.github.io/CarSim/> (Chrome, Edge eller Vivaldi)
- Uten nett: kjør `npm run build` og åpne `dist/carsim.html` direkte i nettleseren

Første gang hentes kartet for området fra OpenStreetMap (noen sekunder). Deretter ligger det
lagret i nettleseren. Feiler hentingen, vises en enkel øvingsbane i stedet.

## Hva som virker nå

| Del | Innhold |
|---|---|
| Kart | Veier, fartsgrenser, enveiskjøring, rundkjøringer, gangfelt og bygninger rundt Furuset Senter |
| Bil | Tesla Model Y (bakhjulsdrift), automat. Publiserte tall for effekt, moment, mål og snusirkel |
| Styring | Tastatur. Ratt, pedaler og kontroller via kalibreringsveiviser (ikke testet på ekte ratt ennå) |
| Visning | Førersete med tre speil, utvendig kamera, se til siden, lite kart |
| Kjørelærer | Fart, kjøring utenfor veien, motgående felt, mot enveiskjøring, blinklys, kollisjon, brå kjøring |
| Rapport | Veiledende bestått/ikke bestått med begrunnelse, anmerkninger på kart, råd om hva som bør øves |

## Kjente begrensninger

- Verden er flat. Bakker mangler, og bruer tegnes på bakkenivå.
- Motorveier (E6) og tunneler er utelatt.
- Ingen andre trafikanter, ingen trafikklys og ingen vikepliktsregler ennå.
- Skilt plasseres ut fra kartdata, ikke fra de faktiske skiltene (Nasjonal vegdatabank kommer senere).
- Ingen kraft i rattet (force feedback). Nettlesere kan ikke styre rattmotoren.
- Tall merket `estimated` i `src/vehicle/cars.js` er anslag og må kontrolleres mot produsentens data.

## Tastatur

| Tast | Funksjon |
|---|---|
| W / ↑ | Gass (Shift = full gass) |
| S / ↓ | Brems (Mellomrom = nødbrems) |
| A D / ← → | Styring |
| Q / E | Blinklys venstre / høyre |
| R | Revers av/på (når bilen står stille) |
| Z / X | Se til venstre / høyre |
| C | Bytt kamera |
| M | Speil av/på |
| T | Sett bilen tilbake på veien |
| P | Pause |
| Enter | Avslutt økten og få vurdering |

## Slik er koden bygget opp

Hver del har én oppgave, og logikken er skilt fra grafikken slik at den kan testes automatisk.

```
index.html            Siden: menyer, instrumenter og utseende (CSS)
src/config.js         Områder og alle toleranser for kjørelæreren
src/main.js           Starter appen og kjører økten (meny -> kjøring -> rapport)
src/sim.js            Én kjøreøkt: bil + kart + kjørelærer (uten grafikk)
src/map/              Henting av kartdata, veinett, øvingsbane
src/vehicle/          Bildata (cars.js) og kjørefysikk (physics.js)
src/rules/            Kjørelæreren (engine.js) og rapporten (report.js)
src/world/            3D-verden og bilmodell (Three.js)
src/view.js           Kamera, speil og automatisk oppløsning
src/input/            Tastatur, ratt, pedaler og kontroller
src/ui/               Meny, instrumenter, rapport, kart og kalibrering
tests/                Automatiske tester
tools/                Lokal server, bygging av én-fil-versjon, nettlesertest
vendor/               Three.js (3D-bibliotek), lagt ved slik at appen virker uten nett
```

### Vanlige endringer

- **Ny bil:** legg til en oppføring i `src/vehicle/cars.js`.
- **Nytt område:** legg til en oppføring i `AREAS` i `src/config.js`.
- **Strengere eller mildere kjørelærer:** endre tallene i `RULES` i `src/config.js`.
- **Ny regel:** legg til en type i `EVENT_TYPES` og en sjekk i `update()` i `src/rules/engine.js`,
  og en test i `tests/rules.test.js`.

## Utvikling

Krever Node.js 22 eller nyere.

```
npm install          # én gang
npm test             # automatiske tester (fysikk, veinett, regler, skilt)
npm run serve        # lokal server på http://localhost:8080
npm run build        # lager dist/carsim.html (alt i én fil)
node tools/browser-test.mjs "http://localhost:8080/?demo"   # kjører appen i hodeløs Chrome
```

`?demo` i adressen tvinger fram øvingsbanen i stedet for ekte kart.

Publisering skjer via GitHub Pages fra `main`-grenen: det som ligger i repoet er det som kjører.

## Feilsøking

- **Kartet lastes ikke:** trykk «Hent kart på nytt» i menyen. Karttjenesten kan være opptatt.
- **Hakkete bilde:** tallet øverst til høyre viser bilder per sekund og oppløsning. Slå av speil med M.
- **Rattet reagerer ikke:** trykk en knapp på rattet, og kjør «Kalibrer ratt og pedaler» i menyen.
  Kalibreringsbildet viser alle akser og knapper direkte.
- **Sende en økt til feilsøking:** «Last ned økten (JSON)» i rapporten lagrer anmerkninger, rute og
  opplysninger om maskinen.

## Kilder og lisenser

- Kartdata © [OpenStreetMap](https://www.openstreetmap.org/copyright)-bidragsytere (ODbL), hentet via Overpass API.
- [Three.js](https://threejs.org/) (MIT), se `vendor/three.LICENSE`.
- Bildata: se `sources` for hver bil i `src/vehicle/cars.js`.
