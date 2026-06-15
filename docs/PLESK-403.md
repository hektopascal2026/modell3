# Plesk: 403 auch bei /modell3/index.php

Wenn **sogar** `index.php` und `check.html` **403 Forbidden** liefern, liegt das **nicht** an fehlender `.htaccess` oder SPA-Routing. Der Webserver darf den Ordner `modell3` (oder den Pfad) nicht lesen — oder er ist aktiv gesperrt.

## 1. Pfad in Plesk verifizieren (häufigster Fehler)

Im Plesk-Dateimanager muss exakt dieser Pfad existieren:

```
httpdocs/modell3/index.php
httpdocs/modell3/check.html
```

**Nicht:**
```
httpdocs/dist/index.php          ← falsch
httpdocs/modell3/dist/index.php  ← falsch
```

Im Dateimanager: `index.php` anklicken → **Im Browser öffnen** (falls angeboten).

---

## 2. Berechtigungen zurücksetzen

**Websites & Domains** → **Dateien** → Ordner `modell3` markieren

1. **Berechtigungen ändern** (Schloss-Symbol)
2. Ordner `modell3` und **alle Unterordner**:
   - Besitzer: Lesen, Ausführen (bei Ordnern auch Schreiben)
   - Gruppe: Lesen, Ausführen
   - Andere: Lesen, Ausführen  
   → entspricht **755** für Ordner
3. Dateien `index.php`, `index.html`, `check.html`:
   → **644** (Lesen für alle)
4. In Plesk gibt es oft **«Standard wiederherstellen»** / **«Restore default»** — das zuerst probieren

**Wichtig:** Auch der Ordner `httpdocs` selbst braucht Ausführungsrecht (Traverse), sonst kommt nginx nie bis `modell3/`.

---

## 3. Verzeichnisschutz deaktivieren

**Websites & Domains** → **Verzeichnisschutz** (Password Protected Directories)

- Jeder Eintrag für `/modell3` oder übergeordnete Pfade → **Entfernen**

Ein aktiver Verzeichnisschutz erzeugt exakt «You don't have permission to access …».

---

## 4. PHP für die Domain aktivieren

**Websites & Domains** → Domain → **PHP-Einstellungen**

- PHP-Version aktiv (z. B. 8.2)
- PHP-Unterstützung: **Aktiviert**

Test: lege in `httpdocs/` (Root, nicht modell3) eine Datei `phpinfo-test.php` an:

```php
<?php phpinfo();
```

Aufruf: `https://deine-domain.ch/phpinfo-test.php`

- **403 auch hier** → Domain-/Server-Problem, Hoster kontaktieren
- **OK im Root, 403 nur in modell3** → Ordnerrechte oder Verzeichnisschutz (Schritt 2+3)
- **Nach Test phpinfo-test.php wieder löschen** (Sicherheit)

---

## 5. nginx-Sicherheitsregeln prüfen

**Websites & Domains** → **Apache & nginx-Einstellungen**

Im Feld **Zusätzliche nginx-Direktiven** nach Einträgen suchen wie:

```nginx
location /modell3 { deny all; }
```

oder restriktive `location ^~ /modell3/` Blöcke ohne `try_files`.  
Falsch gesetzte Direktiven aus früheren Versuchen **entfernen**, speichern, warten.

---

## 6. Empfohlene Lösung: Subdomain (umgeht /modell3 komplett)

Wenn der Unterordner auf dem Shared Hosting hartnäckig gesperrt bleibt:

1. Plesk → **Subdomain hinzufügen**  
   z. B. `finanz.deine-domain.ch`
2. Dokumentenstamm: `httpdocs/finanz` (neuer leerer Ordner)
3. Lokal:
   ```bash
   npm run build:plesk
   ```
4. Inhalt von `dist/` nach `httpdocs/finanz/` hochladen
5. Aufruf: `https://finanz.deine-domain.ch/`

Subdomains haben einen **eigenen Dokumentenstamm** — typische 403-Probleme von Unterordnern entfallen.

---

## 7. Ordner umbenennen (falls «modell3» blockiert wird)

Selten blockieren Security-Module bestimmte Pfadnamen. Test:

1. In Plesk `modell3` → `finanz` umbenennen
2. Neu bauen:
   ```bash
   VITE_BASE_PATH=/finanz/ npm run build
   ```
3. Upload nach `httpdocs/finanz/`
4. Test: `https://deine-domain.ch/finanz/index.php`

---

## 8. Plesk-Logs lesen

**Websites & Domains** → **Protokolle** → **Fehlerprotokoll** (Error log)

Zeitpunkt des 403-Aufrufs suchen — dort steht oft:
- `Permission denied`
- `directory index forbidden`
- `access forbidden by rule`

Diese Zeile an den Hoster schicken, falls nichts hilft.

---

## Entscheidungshilfe

| Test | Ergebnis | Nächster Schritt |
|---|---|---|
| `httpdocs/modell3/index.php` fehlt im Dateimanager | Datei falsch hochgeladen | Upload korrigieren |
| Datei da, URL 403 | Rechte / Verzeichnisschutz | Schritt 2 + 3 |
| Root-`phpinfo-test.php` 403 | Server/Domain-Policy | Hoster-Support |
| Nur `/modell3/` 403, Subdomain OK | Unterordner-Policy | **Subdomain** (Schritt 6) |
