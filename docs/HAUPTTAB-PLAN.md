# Modell 3 — Haupttab-Anpassung (Diskussion)

Stand: 14.06.2026 · Quelle: `20260614_Finanzierungsplan.xlsx`

## Ausgangslage Modell 2

Der Haupttab **«Eingaben (Treiber)»** in Modell 2 vereinfacht Personal und Sachkosten stark:

| Bereich | Modell 2 | Neuer Finanzierungsplan |
|---|---|---|
| Personal | 2 Lohnbänder (Senior/Junior) × 4 Jahres-FTE-Slider | 17 Rollen mit individuellem Salär, FTE, **Monatseintritt pro GJ** |
| Sachkosten | 12 Kategorien oder 25%-Auto-Regel | 23 Positionen, fix/var/einmalig, teils FTE-abhängig |
| Zeitachse | Jahres-FTE-Sprünge (Monat 1/13/25/37) | Gestaffelter Eintritt innerhalb des Jahres (z.B. Sales ab Monat 7) |
| Sozialleistungen | 15% global | 16% auf Bruttolohnsumme |

Die Excel-Logik pro Rolle:

```
Jahreskosten = Salary/Monat × FTE × Monate_im_GJ
Sozialleistungen = 16% × Summe(Bruttolöhne aller Rollen)
```

Monatseintritt wird in Excel als **«Mt.»** pro Geschäftsjahr (GJ) erfasst — nicht als absoluter Kalendermonat, sondern als «wie viele Monate im GJ ist diese Stelle aktiv».

---

## Vorschlag: Neuer Haupttab in 3 Sektionen

### 1. Personalplan (ersetzt Senior/Junior-FTE-Blöcke)

**UI:** Editierbare Tabelle (wie im Excel), eine Zeile pro Rolle.

| Spalte | Feld | Typ | Default aus Excel |
|---|---|---|---|
| Position | `position` | Text (readonly oder Dropdown) | z.B. «CEO/CR» |
| Detail | `detail` | Text | «Oliver Fuchs» |
| Salär/Monat | `salaryMonth` | CHF | 7'000 – 11'000 |
| Head | `head` | Zahl | meist 1 |
| FTE | `fte` | 0–1 | 0.6 – 1.0 |
| Mt. GJ1 | `monthsY1` | 0–12 | gestaffelt |
| Mt. GJ2 | `monthsY2` | 0–12 | meist 12 |
| Mt. GJ3 | `monthsY3` | 0–12 | meist 12 |
| Mt. GJ4 | `monthsY4` | 0–12 | *neu für 48-Mt.-Modell* |

**Monatseintritt — zwei mögliche Interpretationen:**

| Variante | Eingabe | Berechnung Monat 1–48 |
|---|---|---|
| **A (Excel-konform)** | «Mt.» = aktive Monate im GJ | Rolle zählt in GJ1 für N Monate; Verteilung gleichmässig ab Monat 1 oder ab explizitem Startmonat |
| **B (präziser)** | Zusätzlich «Eintritt ab Monat» (1–48) | Rolle aktiv ab `startMonth` für `monthsY1` Monate in GJ1, dann 12 Mt. in GJ2+ |

**Empfehlung:** Variante **B** im UI, mit Excel-Import als Variante A (Startmonat = 1, «Mt.» = Dauer).

Beispiele aus dem Plan:

- Fachjournalist senior: GJ1 nur 5 Mt. → Eintritt Monat 1, aktiv Monate 1–5
- Sales #2: GJ1 leer, GJ2 9 Mt. → Eintritt Monat 13, aktiv 9 Monate
- Assistenz CEO/COO: GJ1 4 Mt. → Eintritt Monat 1 oder Monat 9 (je nach Hiring-Plan)

**Monatskosten-Berechnung (Simulation):**

```js
// Pro Monat m (1–48):
for (const role of roles) {
  if (isRoleActive(role, m)) {
    bruttolohn += role.salaryMonth * role.fte;
  }
}
sozialabgaben = bruttolohn * sozialleistungenPct; // 16%
personalkosten = bruttolohn + sozialabgaben;
```

**Aggregat-Anzeige** unter der Tabelle (live):

- Total Bruttolohn / Monat (aktueller Monat + Jahresschnitt)
- Total FTE (gewichtet)
- Heads
- Abgleich GJ1–GJ4 vs. Excel-Summen (1'400'352 / 1'956'500 / 1'987'800 CHF Personal)

---

### 2. Sach- und Dienstleistungsaufwand (ersetzt 25%-Regel als Default)

**UI:** Zweite Tabelle, Spalten analog Excel.

| Spalte | Beschreibung |
|---|---|
| Position | Kategoriename |
| CHF/Monat | Fixe Monatskosten (wo vorhanden) |
| Typ | `fix` · `var` · `einmalig` · `fte` · `prozent` |
| GJ1–GJ4 | Optional Override (für Einmalkosten, Recruiting, Steuern) |

**Berechnungslogik nach Typ:**

| Typ | Monatskosten |
|---|---|
| `fix` | `unitMonth` (konstant) |
| `var` | `unitMonth` oder Jahres-Override / 12 |
| `einmalig` | Betrag nur im ersten aktiven Monat des GJ (Gründung, Initial Grafik) |
| `fte` | `ratePerFte × aktiveFte` (Spesen 200, Kommunikation 100) |
| `prozent` | Reserve 10% auf Sachkosten **exkl. Freelance** |

**Neue Kategorien vs. Modell 2:**

- Honorare Freelance (16k/Mt., var)
- Initialer Grafikaufwand (50k einmalig GJ1)
- Gründungsaufwand (30k einmalig GJ1)
- Recruiting (10k/10k/15k pro GJ)
- Rechtsberatung (1k/Mt.)
- Kommunikationspauschale (100/PAX/Mt.)
- Aus- und Weiterbildung (ab GJ2)
- Mitgliedschaften (steigend)
- Steuern (Gewinnsteuer ab GJ3)

**Default:** `sachkostenAuto = false` (im Gegensatz zu Modell 2), Werte aus `src/data/finanzierungsplan20260614.json`.

---

### 3. Einnahmen & Funding (weitgehend unverändert)

Funding, Kundenwachstum, Preise, Sponsoring bleiben wie in Modell 2 — diese Treiber sind im Excel noch als «Nicht aktualisiert» markiert und werden separat gepflegt.

---

## Layout-Vorschlag Haupttab

```
┌─────────────────────────────────────────────────────────────┐
│  Eingaben (Treiber)                                         │
├──────────────────────────┬──────────────────────────────────┤
│  Einnahmen & Funding     │  Personalplan (17 Rollen)        │
│  (bestehend)             │  ┌─────────────────────────────┐ │
│                          │  │ Tabelle: Rolle|Salär|FTE|   │ │
│                          │  │ Mt.GJ1|Mt.GJ2|StartMonat    │ │
│                          │  └─────────────────────────────┘ │
│                          │  KPI: FTE · Kosten/Mt. · Δ Excel │
├──────────────────────────┴──────────────────────────────────┤
│  Sach- und Dienstleistungsaufwand (23 Positionen)           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Position | CHF/Mt. | Typ | GJ-Override | Effektiv     ││
│  └─────────────────────────────────────────────────────────┘│
│  Sozialleistungen: 16% (Slider, Default 16%)                 │
└─────────────────────────────────────────────────────────────┘
```

Auf Mobile: Personal und Sachkosten als eigene Sub-Tabs («Personal» · «Sachkosten» · «Einnahmen»).

---

## Datenmodell (TypeScript-artig)

```js
const ROLE_DEFAULTS = [
  {
    id: "role-1",
    position: "CEO/CR",
    detail: "Oliver Fuchs",
    salaryMonth: 10000,
    head: 1,
    fte: 1,
    startMonth: 1,      // neu: absoluter Monatseintritt
    monthsY1: 12,
    monthsY2: 12,
    monthsY3: 12,
    monthsY4: 12,
  },
  // … 16 weitere Rollen aus finanzierungsplan20260614.json
];

const SACHKOSTEN_DEFAULTS = [
  { id: "freelance", position: "Honorare Freelance", unitMonth: 16000, type: "var" },
  { id: "gruendung", position: "Gründungsaufwand", amountY1: 30000, type: "einmalig" },
  { id: "spesen", position: "Reisespesen", ratePerFte: 200, type: "fte" },
  { id: "reserve", position: "Reserve", rate: 0.10, type: "prozent", exclude: ["freelance"] },
  // …
];
```

---

## Migrationspfad von Modell 2

1. `DEFAULTS` → `ROLE_DEFAULTS` + `SACHKOSTEN_DEFAULTS` aus JSON laden
2. `simulation`-Loop: `seniorFte * lohnSenior` ersetzen durch Rollen-Summe mit `isRoleActive()`
3. `guvData`-Aggregation: Personal/Sach/Marketing/Admin aus neuen Kategorien mappen
4. localStorage-Key-Prefix: `hekto3_` (kein Konflikt mit Modell 2)
5. Dummy-Tab-Texte: Lohnband-Durchschnitt → «Ø Bruttolohn über X Rollen»

---

## Offene Fragen

1. **Monatseintritt absolut vs. «Mt.»-Dauer:** Soll der User den Startmonat explizit setzen (z.B. Sales ab Monat 7), oder reicht «5 Mt. in GJ1» mit Start = Monat 1?
2. **GJ4:** Excel hat nur 3 GJ — Modell läuft 48 Monate. GJ4-Werte analog GJ3 übernehmen oder separat editierbar?
3. **Steuern & Gewinnsteuer:** Im Excel ab GJ3 — in der Monatssimulation erst ab Break-even berechnen?
4. **Freelance vs. Personal:** Honorare separat in GuV-Zeile «Externe Dienstleistungen» statt Personal?

---

## Nächster Implementierungsschritt

1. `src/data/finanzierungsplan20260614.json` als Single Source of Truth ✅
2. `src/lib/personnel.js` — `calcMonthlyPersonnel(roles, month)`
3. `src/lib/sachkosten.js` — `calcMonthlySachkosten(items, month, activeFte)`
4. Haupttab-UI: Personal-Tabelle als erstes (höchste Priorität laut Anforderung)
5. Validierung: Jahressummen gegen Excel-Totals (±1%)
