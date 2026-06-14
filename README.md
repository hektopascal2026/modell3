# Finanzmodell Hektopascal — Modell 3

Interaktive 48-Monats-Planung (CHF) auf Basis des überarbeiteten Finanzierungsplans vom 13.06.2026.

## Unterschied zu Modell 2

Modell 3 bildet den detaillierten Finanzierungsplan ab:

- **17 Rollen** mit individuellem Salär, FTE und Monatseintritt pro Geschäftsjahr
- **23 Sachkostenpositionen** mit fix/var/einmalig und FTE-abhängigen Kosten
- **16% Sozialleistungen** auf Bruttolohnsumme (statt 15% auf Senior/Junior-Bänder)

Quelldaten: [`src/data/finanzierungsplan20260614.json`](src/data/finanzierungsplan20260614.json)

## Planung Haupttab

Siehe [`docs/HAUPTTAB-PLAN.md`](docs/HAUPTTAB-PLAN.md) für die vollständige Diskussion der UI- und Berechnungsanpassungen.

## Entwicklung

```bash
npm install
npm run dev
```

## Status

- [x] Repo angelegt, Excel-Daten extrahiert
- [x] Haupttab-Konzept dokumentiert
- [ ] Personal-Tabelle im UI
- [ ] Rollenbasierte Monatssimulation
- [ ] Sachkosten-Tabelle mit neuen Kategorien
