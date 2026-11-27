# Transport Empire (arbejdstitel)

## Hvad vi bygger
Et klassisk transport-tycoon-strategispil i realtid. Spilleren opbygger og driver
et transportselskab ved at anlægge ruter og fragte passagerer og gods på et
proceduralt genereret kort, der er nyt i hvert spil.
Referencer: OpenTTD og Transport Fever 2. Spillet låner gerne mekanikker, men
bruger egne navne, egen grafik og eget indhold. Det kopierer intet fra dem.
Platform: først et webspil, der kan spilles i Safari på iPhone og iPad. Senere
pakkes det som en iOS-app med Expo. Spillets sprog er engelsk.

## Design-søjler (brug dem, når du skal træffe valg)
1. Hvert kort er en ny historie
2. Let at lære, svært at mestre
3. Tilfredsstillende flow: det skal være en fornøjelse at se godset bevæge sig
4. Respekt for spillerens tid: ingen tvungne pauser, autosave altid

## MVP-omfang (version 1.0)
Med i MVP:
- Ét klima (tempereret) på et kvadratisk grid, som tegnes isometrisk.
- Tre kortstørrelser: small 64x64, medium 128x128, large 256x256.
- Terræn: græs, ujævnt land, landbrugsjord, skov (skal ryddes), klipper/bjerge
  (stejle og dyre) og vand (søer, floder, hav; kræver bro).
- Transport: vej (lastbiler og busser) og jernbane (tog).
- Fire varekæder: kul → kraftværk · korn → fødevarefabrik → by ·
  træ → savværk → by · passagerer og post mellem byer.
- Realtid med pause og hastighederne 1x, 2x og 4x.
- Mål: nå et fastsat overskud på bundlinjen inden et bestemt år. Tab: konkurs.

Ikke med i v1.0 (byg det ikke, før jeg beder om det):
AI-rivaler, skibe, fly, flere klimaer, multiplayer, avancerede togsignaler, modding.

## Økonomi
Indtægt pr. levering afhænger af:
- Afstand: jo længere fra kilden, desto højere betaling.
- Hastighed: fuld pris ved hurtig levering. Prisen falder ved langsom levering,
  især for passagerer, post og fødevarer.
- Mængde og godstype: forarbejdede varer betaler mere end råstoffer.
- Tilskud: byer og industrier udlover jævnligt en midlertidig bonus (1,5x eller 2x)
  til den, der først opretter en bestemt rute.

Udgifter: anlæg (vej, spor, bro, rydning, terrænudjævning), køretøjer, drift,
vedligehold og renter. Alle tal ligger i datafiler, så de kan justeres.

## Teknologi
- TypeScript (strict), Vite og PixiJS til isometrisk 2D-rendering.
- Vitest til tests.
- Gemte spil gemmes i browseren som versioneret JSON (IndexedDB).
- Webbuildet udgives på GitHub Pages, så jeg kan spille det på min iPhone.
- Senere: pakkes som iOS-app med Expo/EAS (bygges i skyen; jeg har ingen Mac).
- Tilføj ikke npm-pakker uden at spørge mig og forklare hvorfor.

## Arkitektur
- `src/sim/`: simulationen (økonomi, køretøjer, byer, industri). Ren, deterministisk
  TypeScript med fast tick-rate og ingen afhængighed til rendering eller DOM.
- `src/mapgen/`: kortgenerering. Al tilfældighed går gennem én seedet RNG, så samme
  seed altid giver det samme kort. Kort valideres før brug.
- `src/render/`: PixiJS-rendering, kamera, pinch-zoom og pan.
- `src/ui/`: menuer, paneler og touch-input.
- `src/data/`: JSON med køretøjer, varer, industrier, terræn og priser.
- `tests/`: tests af sim og mapgen.
- Grafik: indtil videre simple, kode-genererede placeholders. Den endelige stil er
  detaljeret isometrisk pixel-art fra købte grafikpakker eller en grafiker. Gør det
  nemt at skifte sprites ud.

## Ydelse
Mindst 60 fps med 200 køretøjer på en iPhone 12 i Safari. Kortet tegnes i chunks.
Brug object pooling. Hold rendering-arbejdet nede, når intet bevæger sig.

## Arbejdsregler
- Læs `docs/GDD.md` og `docs/ROADMAP.md`, før du går i gang med en opgave.
- Jeg har ingen kodeerfaring. Forklar dine valg kort og i almindeligt sprog, og
  fortæl mig præcis, hvad jeg skal gøre, når noget kræver mig.
- Spørg mig om alt, der kan påvirke gameplayet. Tekniske valg må du selv træffe,
  men skriv kort hvorfor.
- Ved større opgaver: vis mig først en plan, og vent på mit OK.
- Skriv tests for al logik i sim og mapgen. Kortgenerering testes på mange seeds.
- En opgave er først færdig, når projektet bygger, alle tests er grønne og du har
  skrevet en kort liste over, hvad jeg skal afprøve i spillet.
- Lav ét commit pr. afsluttet opgave med en beskrivende besked på engelsk.
- Kode, kommentarer og commits skrives på engelsk. Svar til mig skrives på dansk.
- Opdatér `docs/ROADMAP.md`, når en milepæl er nået.
- Er noget uklart eller modstridende: spørg i stedet for at gætte.

## Milepæle (detaljer i docs/ROADMAP.md)
1. Projektopsætning og kortgenerator med seed, vist i browseren med zoom og pan
2. Vejbyggeri med fingeren og en lastbil, der kører mellem to byer
3. Økonomi: varekæder, leverancer, indtægter og udgifter
4. Jernbane og tog
5. Byvækst, tilskud, mål og konkurs
6. UI, gem/indlæs og tutorial
7. Placeholder-grafik skiftes ud med rigtig grafik, plus lyd og polering
8. iOS-app med Expo og TestFlight-beta
