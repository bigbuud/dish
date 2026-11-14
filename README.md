# Dish

Mijn receptenboek als echte, zelf gehoste webapp (PWA) in een retro lijntjes-schrift-look.
Recepten bewaren, opzoeken, porties omrekenen, kookmodus en recepten scannen met de camera (OCR, lokaal).

- **Stack:** TanStack Start (React 19) + Tailwind v4, Node-server via Nitro (`node-server`).
- **Opslag:** één JSON-bestand `recipes.json` in `DATA_DIR` (standaard `./data`, in Docker `/data`).
- **Scannen:** met `GEMINI_API_KEY` leest Google Gemini de foto (ook handschrift) en vult het hele recept in. Zonder sleutel, of als Gemini niet bereikbaar is, valt Dish terug op tesseract.js in de browser (alleen gedrukte tekst; worker, core en Nederlandse taaldata worden door Dish zelf geleverd, geen internet nodig).
- **Beveiliging:** account met wachtwoord + 2-stapsverificatie (authenticator-app), zie hieronder.
- **Installeerbaar:** web-manifest + service worker (vereist https, bv. via Tailscale Serve).

## Lokaal ontwikkelen

```sh
bun install        # of: npm install
bun run dev        # http://localhost:3000
bun run test
```

## Draaien op de NAS (Docker)

```sh
docker compose up -d        # bouwt lokaal en draait op poort 8086
```

Of met de kant-en-klare image uit GitHub Actions (zie `.github/workflows/docker.yml`):
`ghcr.io/bigbuud/dish:latest`. Recepten staan in de map `./data` naast `docker-compose.yml`
— maak daar gewoon een kopie van als back-up.

## Bereikbaar via Tailscale (https, nodig voor installeren + camera)

```sh
tailscale serve --bg --https=8443 8086
# → https://<jouw-nas>.<tailnet>.ts.net:8443
```

Open die URL op je telefoon en kies "Toevoegen aan startscherm" / "App installeren".

## Inloggen en 2-stapsverificatie

- **Eerste keer:** open Dish. Zolang er nog geen account is, kom je automatisch op `/setup`. Maak daar je gebruikersnaam en wachtwoord,
  scan de QR-code met een authenticator-app (Google/Microsoft Authenticator, Aegis, 2FAS, ...) en bewaar de 10 herstelcodes.
  **Doe dit meteen na het opstarten**: wie als eerste `/setup` opent, maakt het account.
- **Daarna:** inloggen met gebruikersnaam, wachtwoord en de 6-cijferige code. De sessie blijft standaard **365 dagen** geldig en schuift
  op zolang je Dish gebruikt (instelbaar met de omgevingsvariabele `SESSION_DAYS`). Op een geïnstalleerde telefoon-app log je dus zelden opnieuw in.
- **Telefoon kwijt:** log in met een herstelcode (elke code werkt één keer).
- **Alles kwijt / opnieuw beginnen:** stop de container en verwijder `auth.json` in de data-map. Bij de volgende start kun je
  een nieuw account maken. Je recepten (`recipes.json`) blijven staan.
- Alle gegevens van het account staan in `auth.json` (wachtwoord gehasht met scrypt, herstelcodes gehasht, sessies als hash).
  Na 5 foute pogingen vanaf één adres is inloggen 15 minuten geblokkeerd.
- Dish hoort achter https te draaien (Tailscale of je reverse proxy). Stuur `X-Forwarded-Proto` mee (NPM doet dat standaard),
  dan krijgt de cookie automatisch de `Secure`-vlag.
