# Deploy auf Plesk

> **403 auch bei `/modell3/index.php`?** → [`docs/PLESK-403.md`](docs/PLESK-403.md) (Rechte, Verzeichnisschutz, Subdomain)

Plesk nutzt **nginx vor Apache**. Ohne `.htaccess` liefert nginx für `/modell3/` oft **403 Forbidden**, weil kein Index gefunden wird — **sofern** der Ordner überhaupt lesbar ist.

## Schritt 1 — Diagnose (2 Minuten)

Nach Upload von `dist/` diese URLs testen:

| URL | Bedeutung |
|---|---|
| `/modell3/check.html` | Statische Datei — Rechte OK? |
| `/modell3/diagnostic.php` | PHP + Dateiliste |
| `/modell3/index.php` | App-Start |

- **Alle 403** → falscher Pfad, Verzeichnisschutz oder Rechte (siehe unten)
- **check.html OK, /modell3/ 403** → typisches Plesk-nginx-Index-Problem (Lösung A oder B)
- **index.php OK** → App läuft; `/modell3/` braucht nginx-Direktive oder Subdomain

---

## Lösung A — Subdomain (empfohlen, kein .htaccess nötig)

1. Plesk → **Websites & Domains** → **Subdomain hinzufügen**  
   z. B. `finanz.deine-domain.ch`
2. Dokumentenstamm: z. B. `httpdocs/finanz` (leerer Ordner)
3. Lokal bauen:
   ```bash
   npm run build:plesk
   ```
4. Inhalt von `dist/` nach `httpdocs/finanz/` hochladen
5. Aufrufen: `https://finanz.deine-domain.ch/`  
   (Dort reicht `index.php` / `index.html` — kein Unterordner-Problem)

`VITE_BASE_PATH=/` ist im Build bereits gesetzt.

---

## Lösung B — Unterordner `/modell3/` (nginx in Plesk anpassen)

`.htaccess`-Upload ist auf Plesk oft blockiert — **nginx-Direktiven in der Oberfläche** setzen:

1. **Websites & Domains** → deine Domain → **Apache & nginx-Einstellungen**
2. Feld **Zusätzliche nginx-Direktiven** → einfügen:

```nginx
location = /modell3 {
    return 301 /modell3/;
}

location ^~ /modell3/ {
    index index.php index.html;
    try_files $uri $uri/ /modell3/index.php?$query_string;
}
```

3. **OK** → 1–2 Minuten warten
4. Test: `https://deine-domain.ch/modell3/`

Build für Unterordner:
```bash
npm run build:subdir
# oder: npm run build  (Default)
```

---

## Lösung C — .htaccess ohne Upload

1. Plesk **Dateien** → `httpdocs/modell3/`
2. `htaccess-upload.txt` hochladen
3. Umbenennen zu `.htaccess` (oder **+ Datei erstellen** mit diesem Namen)

Funktioniert nur, wenn Plesk `.htaccess` **nicht komplett deaktiviert** hat. Bei reinem nginx-Front oft **Lösung B** nötig.

---

## Verzeichnisschutz & Rechte

**Websites & Domains** → **Verzeichnisschutz**  
→ `/modell3` darf **nicht** geschützt sein.

**Dateien** → `modell3` → **Berechtigungen ändern**:
- Ordner: Lesen + Ausführen (755)
- Dateien: Lesen (644)
- `scenarios/`: zusätzlich Schreiben für Webserver-Benutzer

Upload-Struktur (Inhalt von `dist/`, nicht `dist/` als Unterordner):

```
httpdocs/modell3/
  index.php
  index.html
  check.html
  diagnostic.php
  assets/
  api/scenarios.php
  api/config.local.php
  scenarios/scenarios.json
```

---

## Szenarien speichern

`api/config.local.php` — `api_key` = `VITE_SCENARIO_API_KEY` aus `.env.local` beim Build.

Ordner `scenarios/` muss beschreibbar sein.

---

## Kurz-Entscheidung

| Situation | Empfehlung |
|---|---|
| Plesk, kein .htaccess | **Subdomain** (`npm run build:plesk`) |
| Muss unter `/modell3/` bleiben | **nginx-Direktiven** (Lösung B) |
| `/modell3/index.php` funktioniert | App OK; nur Directory-Index fehlt für `/modell3/` |
