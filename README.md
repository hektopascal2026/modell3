# Finanzmodell Hektopascal — Modell 4

Interaktive 48-Monats-Planung (CHF) mit Monitor, Anker-Kunde und Baseline-vs.-Gesamtmodell.

**Deploy:** ausschliesslich `https://seismo.live/modell4/` — Modell 3 lebt im Repo [`hektopascal2026/modell3`](https://github.com/hektopascal2026/modell3).

## Entwicklung

```bash
npm install
npm run dev      # → http://localhost:5173/modell4/
npm run build
npm run preview  # → http://localhost:4173/modell4/
```

## Szenarien (geräteübergreifend)

Szenarien werden in `scenarios/scenarios.json` auf dem Server gespeichert.

### Shared Hosting (empfohlen)

> **Plesk 403 — auch bei `/modell4/index.php`?** → [`docs/PLESK-403.md`](docs/PLESK-403.md)  
> Meist: **Verzeichnisschutz**, falsche Rechte oder falscher Upload-Pfad. **Subdomain** (`npm run build:plesk`) umgeht das zuverlässig.

1. **Build mit API-Key:**
   ```bash
   cp .env.example .env.local
   # VITE_SCENARIO_API_KEY setzen (langer Zufallswert)
   npm run build
   ```
2. **Upload:** Inhalt von `dist/` (nicht den Ordner `dist` selbst!) nach `/modell4/` auf dem Hosting:
   ```
   /modell4/index.php      ← wichtig für Plesk
   /modell4/index.html
   /modell4/htaccess-upload.txt   ← optional, in Plesk zu .htaccess umbenennen
   /modell4/assets/...
   /modell4/api/...
   /modell4/scenarios/...
   ```
3. **Rechte (FTP/SSH):** Ordner `755`, Dateien `644` — besonders `scenarios/` muss für PHP beschreibbar sein
3. **Server-Config:** Auf dem Hosting anlegen:
   ```bash
   # public/api/config.local.php (von config.example.php kopieren)
   ```
   ```php
   return [
       'api_key' => 'derselbe-wert-wie-VITE_SCENARIO_API_KEY',
       'data_file' => __DIR__ . '/../scenarios/scenarios.json',
   ];
   ```
4. **Schreibrechte:** Ordner `scenarios/` muss für PHP beschreibbar sein (chmod 755 oder 775)

- **Laden:** Dropdown → Laden (ohne Login)
- **Speichern:** Button «Speichern» → schreibt via `api/scenarios.php`

### Fehler «You don't have permission to access /modell4/»

Typisch Apache **403** — auf **Plesk** siehe [`docs/PLESK-DEPLOY.md`](docs/PLESK-DEPLOY.md).

Kurz:
1. `index.php` liegt direkt in `/modell4/`?
2. Test: `https://deine-domain.ch/modell4/index.php`
3. Kein Verzeichnisschutz in Plesk auf `modell3`?
4. Upload-Inhalt von `dist/`, nicht `dist/` als Unterordner

### Lokale Entwicklung

- **Speichern auf Hosting:** Build mit `VITE_SCENARIO_API_KEY` und auf Server deployen
- **Speichern via GitHub (optional):** `VITE_GITHUB_SCENARIO_TOKEN` in `.env.local` als Fallback für `npm run dev`

```bash
npm run dev   # → http://localhost:5173/modell4/
```

### Deploy auf seismo.live (VPS)

```bash
./scripts/deploy-seismo.sh
```

Live: **https://seismo.live/modell4/** — Szenario-Speichern via `api/scenarios.php`.

## Status

- [x] Repo angelegt, Excel-Daten extrahiert
- [x] Haupttab-Konzept dokumentiert
- [x] Personal-Tabelle im UI (Startmonat, FTE, Mt. GJ1–GJ3)
- [x] Sachkosten-Tabelle mit GJ1–GJ3-Spalten (GJ4 = GJ3)
- [x] Rollenbasierte Monatssimulation inkl. Kapitalsteuer + Gewinnsteuer
