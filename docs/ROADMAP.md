# Roadmap – Transport Empire

Claude arbejder på én milepæl ad gangen og i denne rækkefølge. En milepæl er
først færdig, når alle punkter under "Færdig når" er opfyldt, projektet bygger,
alle tests er grønne, og der er skrevet en liste over, hvad ejeren skal afprøve.
Status opdateres her, når en milepæl er nået.

Status: ⬜ ikke startet · 🟨 i gang · ✅ færdig

Spil den seneste version: https://stilling-svg.github.io/transport-empire/

---

## Milepæl 1 – Projektopsætning og kortgenerator ✅
**Mål:** Et kort ud fra et seed, som kan ses og udforskes i browseren på iPhone.

Indhold:
- Projekt med TypeScript, Vite, PixiJS og Vitest. Mappestruktur som i CLAUDE.md.
- Automatisk udgivelse til GitHub Pages ved hvert push til main.
- Seedet RNG og kortgenerator efter GDD afsnit 3 (højder, vand, floder, terræn,
  byer og industrier som simple markører).
- Isometrisk visning med placeholder-grafik, pinch-zoom og pan med touch og mus.
- Knap til nyt tilfældigt kort. Seed og kortstørrelse vises på skærmen.

Færdig når:
- [x] Samme seed og indstillinger giver identisk kort (test)
- [x] 1.000 seeds pr. kortstørrelse genereres uden fejl (test)
- [x] Alle kort består valideringen i GDD 3.3 (test)
- [x] Et large-kort genereres på under 3 sekunder
- [x] Spillet kan åbnes på ejerens iPhone via GitHub Pages-linket

## Milepæl 2 – Vejbyggeri og første lastbil ⬜
**Mål:** Spilleren bygger en vej og ser et køretøj køre på den.

Indhold:
- Spilløkke med fast tick-rate (simulationen adskilt fra rendering), pause og 1x/2x/4x.
- Værktøjslinje med tilstandene Se, Vej og Nedrivning.
- Træk-for-at-bygge vej med forhåndsvisning og pris (uden penge endnu). Fortryd.
- Busstoppested, vejdepot og én bus, der kører mellem to stoppesteder med A*.

Færdig når:
- [ ] Vej kan bygges og rives ned med fingeren på iPhone
- [ ] En bus kører frem og tilbage mellem to stoppesteder uden at køre forkert
- [ ] Ruteplanlægningen er testet med forhindringer og manglende forbindelse
- [ ] 60 fps med 100 busser på medium-kort

## Milepæl 3 – Økonomi og varekæder ⬜
**Mål:** Penge tjenes og bruges, og alle fire varekæder fungerer på vej.

Indhold:
- Penge, priser på anlæg og køretøjer, månedlig drift, lån og renter (GDD 5–6).
- Industrier med produktion, opland og omdannelse (GDD 4).
- Hauler Truck og Courier Van. Ruteordrer med "Vent på fuld last".
- Betalingsformlen med tidsfaktor.
- Simpelt økonomipanel og top-bar med penge og dato.

Færdig når:
- [ ] Betalingsformlen er testet for alle varetyper
- [ ] Alle fire kæder kan køres fra kilde til aftager
- [ ] En simuleret bot-spiller kan tjene penge på et standardkort (test)

## Milepæl 4 – Jernbane og tog ⬜
**Mål:** Tog fragter gods og passagerer over længere afstande.

Indhold:
- Træk-for-at-bygge spor, broer, banegårde og togdepot.
- Lokomotiver og vogne fra GDD 5.2. Tog sammensættes i depotet.
- Strækningsreservation, så tog ikke støder sammen.
- Hældning påvirker fart (GDD 3.2).

Færdig når:
- [ ] To tog kan dele en strækning uden at gå i baglås (test)
- [ ] Et kultog fra mine til kraftværk giver overskud
- [ ] 60 fps med 200 køretøjer i alt på medium-kort

## Milepæl 5 – Byvækst, tilskud, mål og konkurs ⬜
**Mål:** Et komplet spil, som kan vindes og tabes.

Indhold:
- Byvækst (GDD 4.3) og produktionsændringer (GDD 4.2).
- Tilskud og omdømme (GDD 6.4).
- Sværhedsgrader, mål, sejr og konkurs (GDD 7).
- Nye køretøjer låses op med årstallet.

Færdig når:
- [ ] En bot-spiller kan nå målet på Normal på de fleste seeds (test på 50 seeds)
- [ ] Konkurs og sejr udløses korrekt (test)
- [ ] Ejeren har spillet et helt spil igennem og givet feedback

## Milepæl 6 – UI, gem/indlæs og tutorial ⬜
**Mål:** Spillet kan bruges af en ny spiller uden hjælp.

Indhold:
- Hovedmenu, opsætning af nyt spil (GDD 2) og alle paneler (GDD 8).
- Autosave og tre gemmepladser med versionering (GDD 9).
- Interaktiv tutorial på et fast, håndlavet kort (højst 5 minutter).

Færdig når:
- [ ] Gemte spil overlever genindlæsning af siden og en ny version af spillet (test)
- [ ] 3 testspillere gennemfører tutorialen uden hjælp

## Milepæl 7 – Grafik, lyd og polering ⬜
**Mål:** Spillet ser ud og lyder som et færdigt produkt.

Indhold:
- Placeholder-grafik skiftes ud med den valgte pixel-art (ejeren skaffer grafikken).
- Animationer, musik og lydeffekter.
- Balancering ud fra spiltests og ydelsesoptimering.

Færdig når:
- [ ] Ingen placeholders tilbage
- [ ] 60 fps på iPhone 12 i et sent spil
- [ ] Mindst 5 testspillere har spillet et helt spil igennem

## Milepæl 8 – iOS-app og beta ⬜
**Mål:** Spillet ligger i TestFlight og er klar til App Store.

Indhold:
- Spillet pakkes som iOS-app med Expo, og appen bygges i skyen med EAS.
- Gemte spil virker i appen. Haptik ved byggeri og leveringer.
- Ikon, opstartsskærm, privatlivsoplysninger og butiksside.

Færdig når:
- [ ] Appen er installeret via TestFlight på ejerens iPhone
- [ ] Beta med 50+ testere er gennemført, og de største fejl er rettet

Kræver ejeren: Apple Developer-konto og arbejde i App Store Connect.

---

## Efter v1.0 (ikke startet – byg ikke før ejeren beder om det)
AI-rivaler · skibe og havne · fly og lufthavne · flere klimaer · togsignaler ·
daglig udfordring · flere sprog · Android
