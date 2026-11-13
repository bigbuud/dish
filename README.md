# Dish

Mijn receptenboek als echte, zelf gehoste webapp (PWA) in een retro lijntjes-schrift-look.
Recepten bewaren, opzoeken, porties omrekenen, kookmodus en recepten scannen met de camera (OCR, lokaal).

- **Stack:** TanStack Start (React 19) + Tailwind v4, Node-server via Nitro (`node-server`).
- **Opslag:** één JSON-bestand `recipes.json` in `DATA_DIR` (standaard `./data`, in Docker `/data`).
- **Scannen:** tesseract.js draait in de browser; worker, core en Nederlandse taaldata worden door Dish zelf geleverd (geen internet nodig).
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
