# WG Board – Einrichtung (kostenlos, ca. 10 Minuten)

Du brauchst zwei kostenlose Dienste:
1. **Supabase** – die Datenbank, damit alle WG-Mitglieder auf jedem Gerät den gleichen Stand sehen (Echtzeit-Sync).
2. **Vercel** – zum Hosten der Web-App unter einer eigenen URL.

Beides hat einen dauerhaft kostenlosen Tarif, der für eine WG-App völlig ausreicht.

---

## Schritt 1: Supabase-Projekt erstellen

1. Auf **https://supabase.com** einloggen (du hast ja schon einen Account) → **„New Project"**.
2. Name frei wählbar (z. B. „wg-board"), ein Datenbank-Passwort setzen (merken, wird aber nicht mehr gebraucht), Region z. B. „Frankfurt (eu-central-1)".
3. Warten, bis das Projekt fertig eingerichtet ist (ca. 1–2 Minuten).

## Schritt 2: Datenbank-Tabellen anlegen

1. Im Supabase-Dashboard links auf **SQL Editor** klicken → „New query".
2. Den kompletten Inhalt der Datei **`schema.sql`** (liegt in diesem Ordner) kopieren und einfügen.
3. Auf **Run** klicken. Es sollte „Success" erscheinen.

## Schritt 3: Zugangsdaten eintragen

1. Im Supabase-Dashboard links auf **Project Settings → API** gehen.
2. Dort findest du:
   - **Project URL** (sieht aus wie `https://abcdefgh.supabase.co`)
   - **anon public key** (ein langer String)
3. Öffne die Datei **`config.js`** in diesem Ordner und trage beide Werte ein:

```js
window.SUPABASE_URL = "https://abcdefgh.supabase.co";
window.SUPABASE_ANON_KEY = "ey...dein-langer-key...";
```

Speichern.

> Hinweis: Der „anon key" darf öffentlich im Frontend-Code stehen, das ist bei Supabase so vorgesehen. Die App hat bewusst kein Login – wer den Beitrittscode der WG kennt, kann mitmachen („Vertrauens-App").

## Schritt 4: App kostenlos online stellen (Vercel)

1. Lade den ganzen `wg-app`-Ordner als neues Repository bei **GitHub** hoch:
   - Auf **github.com/new** ein neues Repository erstellen (z. B. „wg-board").
   - Auf der Repo-Seite „uploading an existing file" klicken → alle Dateien aus diesem Ordner per Drag & Drop hochladen → „Commit changes".
2. Auf **https://vercel.com** einloggen (du hast ja schon einen Account) → **„Add New…" → „Project"**.
3. „Import Project" → das gerade erstellte GitHub-Repo auswählen → **„Deploy"** klicken (keine Build-Einstellungen nötig, es ist eine reine HTML/JS-App ohne Framework).
4. Nach ca. 30 Sekunden bekommst du eine Live-URL wie `https://wg-board-xyz.vercel.app`. Diesen Link an alle Mitbewohner schicken.

Das kostet **0 €/Monat** bei normaler WG-Nutzung (die kostenlosen Kontingente von Supabase und Vercel liegen weit über dem, was eine Handvoll Mitbewohner erzeugen).

## Schritt 5: Benutzung

1. Die Live-URL auf dem Handy öffnen (am besten „Zum Startbildschirm hinzufügen", dann sieht es aus wie eine echte App).
2. Erste Person: **„WG erstellen"**, Namen vergeben.
3. Unter **Einstellungen** die Mitbewohner mit Namen und ihrem Soll-Anteil (%) anlegen.
4. Den angezeigten **Beitrittscode** an die anderen Mitbewohner schicken.
5. Alle anderen öffnen die gleiche URL → **„WG beitreten"** mit dem Code → eigenes Profil anlegen oder auswählen.
6. Unter **Aktivitäten** Aufgaben mit Titel, Beschreibung, Wiederholungszyklus (Schieberegler, 1–60 Tage), Punktewert und Zuständigkeit anlegen.
7. Auf der **Home**-Seite sieht jeder den Punktestand aller und die nach Dringlichkeit sortierte Aufgabenliste. Auf eine Aufgabe tippen → **„Aufgabe erledigt"** → Person auswählen, die es gemacht hat → Punkte werden gutgeschrieben, Timer startet neu.

## Später etwas ändern?

Datei im GitHub-Repo bearbeiten (Stift-Symbol) → „Commit changes". Vercel deployt automatisch neu, sobald sich das Repo ändert (ca. 30 Sekunden).

## Wofür die Prozentwerte in den Einstellungen gut sind

Der Soll-Anteil pro Person ist eine reine Orientierungsgröße: Auf der Home-Seite wird unter dem Punktebalken angezeigt, wie viel Prozent der insgesamt erledigten Punkte eine Person tatsächlich beigetragen hat – zum Vergleich mit ihrem vereinbarten Soll-Anteil. So seht ihr auf einen Blick, ob sich jemand (bewusst) mehr oder weniger als vereinbart beteiligt, ohne dass die App die Zuteilung automatisch erzwingt.
