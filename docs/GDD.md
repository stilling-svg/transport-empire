# Game Design Document – Transport Empire (MVP)

Dette dokument beskriver reglerne for version 1.0. Alle tal er **starttal til
balancering**. De ligger i `src/data/` og justeres efter spiltest. Ændres et
regelsæt, så opdateres dette dokument først.

---

## 1. Overblik

- **Genre:** Transport-tycoon-strategi i realtid med pause og hastigheder (1x/2x/4x).
- **Kerne-loop:** Spilleren aflæser kortet, bygger forbindelser, sætter køretøjer
  ind og tjener penge. Byer og industrier vokser af det, og pengene bruges til at
  udvide netværket.
- **Et spil varer** 30–90 minutter afhængigt af mål og hastighed.
- **Spilstart:** år 1930. Nye køretøjer bliver tilgængelige med tiden.
- **Tid:** 1 spildag = 1 sekund ved 1x. 1 år ≈ 6 minutter ved 1x.

## 2. Spilstart og indstillinger

Når spilleren starter et nyt spil, vælger hun/han:

| Indstilling | Valg | Standard |
| --- | --- | --- |
| Kortstørrelse | Small 64x64 · Medium 128x128 · Large 256x256 | Medium |
| Sværhedsgrad | Easy · Normal · Hard | Normal |
| Vandmængde | Low · Medium · High | Medium |
| Terræn | Flat · Hilly · Mountainous | Hilly |
| Antal byer | Few · Normal · Many | Normal |
| Seed | Tilfældigt eller indtastet | Tilfældigt |

Seedet vises i spillet og kan kopieres, så spillere kan dele kort.

## 3. Kortgenerering

### 3.1 Pipeline
1. **Seed** → én seedet RNG (fx mulberry32 eller sfc32). Samme seed og samme
   indstillinger giver altid præcis det samme kort.
2. **Højdekort:** lagdelt simplex-støj (fBm), heltalshøjder 0–15.
3. **Vand:** felter under havniveau bliver hav. Søer dannes i lavninger. Floder
   løber fra højt terræn mod havet.
4. **Terræn:** græs, ujævnt land, klipper på stejlt terræn og skov i klynger.
5. **Byer:** placeres på fladt land nær vand og med god afstand til hinanden.
6. **Industrier:** placeres efter terræn (miner i bakker, skov i skovområder,
   gårde på sletter) og nær relevante aftagere.
7. **Landbrugsjord:** lægges rundt om gårde.
8. **Validering** (afsnit 3.3). Fejler kortet, rettes det, eller der genereres
   igen med et afledt seed.

### 3.2 Terræn

| Terræn | Byggepris (multiplikator) | Note |
| --- | --- | --- |
| Græs | 1,0 | Billigst og mest almindeligt |
| Ujævnt land | 1,2 | |
| Landbrugsjord | 1,5 | Skal ryddes |
| Skov | 1,0 + rydning $50/felt | Rydning nær en by koster omdømme (afsnit 6.4) |
| Klipper/bjerge | 3,0 | Stejlt og dyrt |
| Vand | Kræver bro | Landtransport kan ikke krydse vand uden bro |

**Hældning:** at bygge på skrånende felter koster ×1,5. Tog kører 30 % langsommere
op ad bakke. Lastbiler og busser kører 20 % langsommere op ad bakke.

### 3.3 Valideringsregler
Et kort er spilbart, når alle reglerne er opfyldt:
- Mindst 4 / 8 / 14 byer (small / medium / large).
- Mindst 70 % af landfelterne hænger sammen i ét landområde.
- Alle fire varekæder har mindst én kilde og én aftager inden for 40 felter af
  hinanden på samme landområde.
- Ingen byer eller industrier ligger på vand eller oven i hinanden.
- Byer ligger mindst 12 felter fra hinanden.

## 4. Byer og industrier

### 4.1 Varer

| Vare | Enhed | Basistakst | Hurtig-grænse (dage) | Følsomhed for tid |
| --- | --- | --- | --- | --- |
| Passagerer | personer | 4 | 10 | Høj |
| Post | sække | 5 | 8 | Høj |
| Fødevarer | ton | 5 | 15 | Høj |
| Kul | ton | 3 | 40 | Lav |
| Korn | ton | 3 | 30 | Middel |
| Træ | ton | 3 | 40 | Lav |
| Planker | ton | 4 | 30 | Lav |

### 4.2 Varekæder og industrier

| Industri | Producerer | Modtager | Grundproduktion pr. måned |
| --- | --- | --- | --- |
| Kulmine | Kul | – | 60 t |
| Kraftværk | – | Kul | (aftager alt) |
| Gård | Korn | – | 50 t |
| Fødevarefabrik | Fødevarer | Korn | Omdanner 1:1 |
| Skov | Træ | – | 50 t |
| Savværk | Planker | Træ | Omdanner 1:1 |
| By | Passagerer, Post | Passagerer, Post, Fødevarer, Planker | Passagerer: indbyggere / 8, post: indbyggere / 20 |

**Produktionsændringer:** Hver måned vurderes hver kilde. Transporteres mindst
60 % af produktionen, er der en chance for, at produktionen stiger. Betjenes en
industri dårligt (under 20 %), er der risiko for fald. Industrier kan lukke og nye
kan åbne – se afsnit 12.

### 4.3 Byvækst
En by vokser hurtigere, når den
- har en station med passager- og/eller posttrafik,
- har fået fødevarer leveret den seneste måned,
- har fået planker leveret den seneste måned.

Byer bygger nye huse og veje automatisk. De river aldrig spillerens anlæg ned.

## 5. Transport

### 5.1 Infrastruktur

| Anlæg | Pris pr. felt (på græs) | Note |
| --- | --- | --- |
| Vej | $100 | Byernes egne veje må bruges gratis |
| Jernbane | $200 | Lige stykker og diagonaler |
| Bro (vej/bane) | $1.000 | Spænder over vand eller dale, maks. 10 felter |
| Busstoppested / læsseplads | $800 | Opland 3 felter |
| Banegård | $1.500 pr. perronfelt | Opland 4 felter, 2–6 felter lang |
| Depot (vej/tog) | $1.000 | Her købes og vedligeholdes køretøjer; maks. 8 køretøjer pr. depot |

**Opland:** En station kan kun hente fra og levere til industrier og huse
inden for sit opland.

**To slags vejstop:** busstoppesteder tager passagerer og post (busser og
postvogne); læssepladser tager gods (lastbiler). Gods har ingen bestemt
destination: det betales ved ethvert stop, hvor varen modtages. Industrier og
byer lægger kun gods ved stop, som et køretøj med den vare har i sin rute.

### 5.2 Køretøjer (fiktive navne)

| Køretøj | Type | Fra år | Kapacitet | Fart | Pris | Drift/år |
| --- | --- | --- | --- | --- | --- | --- |
| Rambler Bus | Vej | 1930 | 30 passagerer | 56 km/t | $12.000 | $1.200 |
| Courier Van | Vej | 1930 | 20 sække post | 64 km/t | $10.000 | $1.000 |
| Hauler Truck | Vej | 1930 | 20 t (vælg vare) | 48 km/t | $15.000 | $1.500 |
| Metro Coach | Vej | 1965 | 45 passagerer | 90 km/t | $25.000 | $2.000 |
| Kestrel (damp) | Lokomotiv | 1930 | – | 80 km/t | $50.000 | $5.000 |
| Falcon (diesel) | Lokomotiv | 1955 | – | 120 km/t | $90.000 | $7.000 |
| Swift (el) | Lokomotiv | 1975 | – | 160 km/t | $140.000 | $8.000 |
| Personvogn | Vogn | 1930 | 40 passagerer | – | $6.000 | $400 |
| Postvogn | Vogn | 1930 | 30 sække | – | $6.000 | $400 |
| Åben godsvogn | Vogn | 1930 | 30 t kul/korn/træ | – | $5.000 | $300 |
| Lukket godsvogn | Vogn | 1930 | 25 t fødevarer/planker | – | $7.000 | $400 |

Elektriske lokomotiver kører på almindelige spor i MVP (ingen elektrificering).
Køretøjer har en levetid på 25 år. Derefter går de oftere i stykker (afsnit 12).

### 5.3 Ruter og ordrer
- Spilleren giver et køretøj en rute ved at trykke på stationerne i rækkefølge.
- Tryk på et køretøj for at se status, pålidelighed, fortjeneste og ruten tegnet på
  kortet. Ruten kan redigeres: stop kan tilføjes, fjernes og sættes til fuld last.
- Hver ordre kan sættes til **"Vent på fuld last"**.
- Køretøjer finder vej med A* på vej- og sporgrafen.
- **Tog i MVP:** et tog reserverer strækningen mellem to stationer eller sidespor,
  før det kører ind på den. Der er ingen signaler, som spilleren placerer selv.
  Rigtige signaler kommer efter v1.0.
- Vejkøretøjer kan overhale og møde hinanden. De kører ikke gennem hinanden.
  (Milepæl 3: køretøjer holder kø bag hinanden i samme vognbane; overhaling kommer
  senere. Højst 2 køretøjer læsser ved et stop ad gangen.)
- Køretøjer kan sælges for 75 % af købsprisen.

## 6. Økonomi

### 6.1 Indtægt pr. levering
```
betaling = basistakst × mængde × afstand × tidsfaktor × tilskud × sværhedsmultiplikator
```
- **afstand** = Manhattan-afstand i felter mellem afhentnings- og leveringsstation.
- **tidsfaktor** = 1,0 indtil hurtig-grænsen. Derefter falder den lineært. Varer
  med høj følsomhed rammer gulvet på 0,25 efter 3 × grænsen, varer med lav
  følsomhed efter 6 × grænsen.
- **tilskud** = 1,0 normalt, 1,5 eller 2,0 på en aktiv tilskudsrute.
- **betalingsfaktor** = 0,3 (balancetal i `src/data/economy.json`), så en lastbil- eller
  busrute tjener sig hjem på 1–5 år.

### 6.2 Udgifter
Anlæg og køretøjer betales ved køb. Driften af køretøjer trækkes månedligt.
Vedligehold af infrastruktur koster 2 % af anlægsprisen om året. Renter af lån
trækkes månedligt.

### 6.3 Penge og lån

| | Easy | Normal | Hard |
| --- | --- | --- | --- |
| Startkapital | $300.000 | $200.000 | $100.000 |
| Maks. lån | $500.000 | $300.000 | $200.000 |
| Rente pr. år | 3 % | 5 % | 8 % |
| Betalingsmultiplikator | 1,25 | 1,0 | 0,8 |

Lån optages og tilbagebetales i trin af $10.000.

### 6.4 Tilskud og omdømme
- Hver 3. spilmåned (i gennemsnit) udlover en by eller industri et tilskud på en
  bestemt rute (vare A → B). Tilbuddet gælder i 1 år.
- Den, der først leverer på ruten, får ×1,5 i 2 år (×2,0 på Easy).
- Hver by har et omdømme (0–100) over for spilleren. Fældning af skov nær byen og
  nedrivning af huse sænker omdømmet. God betjening hæver det.
  Under 20 må spilleren ikke bygge stationer i byen.

## 7. Mål, sejr og nederlag

- **Mål:** nå en samlet fortjeneste (indtægter minus udgifter, akkumuleret) inden
  et bestemt år.

| Sværhedsgrad | Mål | Frist |
| --- | --- | --- |
| Easy | $1.000.000 | 1945 |
| Normal | $2.000.000 | 1945 |
| Hard | $3.000.000 | 1945 |

- **Sejr:** målet er nået. Spilleren kan vælge at spille videre i fri tilstand.
- **Nederlag (konkurs):** kassebeholdningen er negativ, og lånet er maksimalt.
  Spilleren advares efter 1 og 3 måneder. Efter 6 måneder i træk er spillet tabt.
- **Fri sandkasse:** samme regler, men uden mål og frist.

## 8. Styring og UI (touch først)

- **Tilstande:** Se · Vej · Jernbane · Station · Depot · Nedrivning. Tilstanden
  vælges i en værktøjslinje nederst, hvor tommelfingeren når.
- **Se-tilstand:** træk med én finger for at panorere, knib for at zoome, tryk
  for at se info om et felt, et køretøj eller en by.
- **Byggetilstande:** træk med fingeren for at bygge. En gennemsigtig
  forhåndsvisning viser prisen, før man slipper. Panorering sker med to fingre.
- **Rotation:** kortet kan drejes 90° ad gangen, så det ses fra fire sider. Det sker
  med knapperne ⟲ ⟳ i top-baren, ved at dreje to fingre på skærmen eller med
  tasterne Q/E. Rotationen ændrer kun visningen, ikke selve spillet.
- **Fortryd** (Undo) af de seneste 10 byggehandlinger. Fortryd refunderer hele
  prisen.
- **Top-bar:** penge, dato, hastighed (pause/1x/2x/4x) og fremskridt mod målet.
- **Paneler:** køretøjsliste, stationsoversigt, økonomi (månedsregnskab),
  tilskud og byer.
- Tryk-mål er mindst 44 punkter. Farver kombineres altid med ikoner.

## 9. Gem og indlæs

- **Autosave:** hver spilmåned og når appen lukkes eller skjules.
- Tre manuelle gemmepladser.
- Gemte spil indeholder seed, indstillinger, versionsnummer og fuld spiltilstand.
- Gemte spil fra ældre versioner skal kunne indlæses (migrering ved versionsskift).

## 10. Grafik og lyd

- **Endelig stil:** isometrisk pixel-art i 90'er-stil med animationer (røg fra
  damplokomotiver, blinkende signaler, kraner). Det skal ligne et levende
  modeltogsanlæg.
- **Indtil da:** enkle, kode-genererede placeholders (farvede romber og simple
  former). Hver vare og køretøjstype har sin egen farve og sit eget ikon.
- Spillerens selskabsfarve bruges på køretøjer og stationer.
- **Lyd (senere):** rolig musik og korte effekter ved levering, byggeri og togfløjt.

## 11. Åbne spørgsmål (besvares senere)

- Daglig udfordring med samme seed for alle (efter v1.0?).
- Indkøb af grafik: hvilken pakke eller grafiker, og hvilken licens?
- Endeligt navn på spillet.
- Lokalisering til flere sprog end engelsk.

## 12. Tilfældige hændelser

Formålet er spændende beslutninger, ikke straf. Tre regler:
1. **Varsel før det slemme** (lukning varsles 3 måneder før, strejke 1 måned før).
2. **Spilleren kan gøre noget** (service mod nedbrud, betjening mod lukning,
   flere ruter mod uheld på én).
3. **Rolig start:** ingen negative hændelser det første år.

Alt styres af en seedet RNG, så samme seed og samme handlinger giver samme forløb.
Tal ligger i `src/data/events.json`. Hændelser vises i en nyhedslinje og et
nyhedsarkiv (📰), hvorfra man kan hoppe til stedet på kortet.

### 12.1 Nedbrud og service
- Pålidelighed starter på 100 % og falder 0,35 %-point om dagen (dobbelt så hurtigt
  efter 25 år), ned til 20 %.
- Risiko for nedbrud pr. dag = (1 − pålidelighed)² × 8 %. Et nedbrud stopper
  køretøjet 2–4 dage på vejen, og køretøjer bag det holder i kø.
- Hver 120. dag kører køretøjet selv til sit depot til service (1 dag), og
  pålideligheden bliver 100 % igen (85 % for køretøjer over 25 år).
  Spilleren kan også sende et køretøj til service.
- Hvert depot har plads til 8 køretøjer. Et depot med køretøjer kan ikke rives ned.

### 12.2 Industrier lever
- Produktion stiger (×1,25, op til 4× start) ved god betjening og falder (×0,8, ned
  til ¼) ved dårlig betjening. Ubetjente industrier får lov at være i fred.
- En industri, der har været helt ubetjent i 24 måneder, kan (2 % pr. måned)
  varsle lukning om 3 måneder. Begynder spilleren at betjene den, aflyses lukningen.
  Den sidste industri af en slags lukker aldrig.
- Nye industrier åbner (ca. 7 % chance pr. måned, mere hvis der er færre end ved
  start) på ledige pladser på kortet.

### 12.3 Korte begivenheder (ca. 30 % chance pr. måned)
| Begivenhed | Virkning | Varighed |
| --- | --- | --- |
| Fund / rekordhøst / fint tømmer | Dobbelt produktion, oftest hos en betjent industri | 3–6 mdr. |
| Strejke | Ingen produktion hos en betjent industri (varsles en måned før) | 1 md. |
| Byfest | Dobbelt så mange passagerer i en by | 1 md. |
| Lavkonjunktur | Leveringer betaler 25 % mindre | 6 mdr. |
| Brændstofpriser | Driftsudgifter ±20 % | 12 mdr. |

