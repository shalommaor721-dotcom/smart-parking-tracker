# 🚀 Galactic Spaceport - Smart Parking License Plate Tracker

**Track 2 - Full Stack DevOps** (Class 14)

A smart parking lot system. An IoT camera reads license plates and sends them to our API (`HTTP POST`).
The guard's dashboard polls the API with JavaScript and shows the cars in real time - no page refresh.

> **Team:** _fill in names_ &nbsp;|&nbsp; **Theme:** Galactic Spaceport (cars are "ships", parking spots are "docking bays")

## Architecture

```
 IoT camera (POST)            Browser (dashboard)
        │                            │  fetch() every 2s
        │                            ▼
        │                  ┌──────────────────┐
        │                  │ web  (Nginx :8080)│  serves HTML/JS/CSS
        │                  │  /api/ → proxy    │
        │                  └─────────┬─────────┘
        ▼                            ▼
   ┌─────────────────────────────────────┐
   │ api  (Node.js + Express :3000)      │  POST /api/plates, GET /api/plates
   └──────────────────┬──────────────────┘
                      ▼
   ┌─────────────────────────────────────┐
   │ redis (Redis 7, AOF persistence)    │──► volume: redis-data (/data)
   └─────────────────────────────────────┘
```

| Service | Technology | Role |
|---------|-----------|------|
| `web`   | Nginx + HTML/JS | Static dashboard, reverse-proxies `/api/` to the API |
| `api`   | Node.js (Express) | Backend: receives plates (POST), serves data (GET), calculates price |
| `redis` | Redis 7 with `--appendonly yes` | Database. Data is written to a **named volume**, so it survives `docker compose down` |

## Run it

```bash
docker compose up --build -d
```

- Dashboard: <http://localhost:8080>
- API: <http://localhost:3000/api/plates>

Send a plate like the camera does:

```bash
./camera-simulator/simulate.sh              # random plate
./camera-simulator/simulate.sh 123-45-678   # specific plate
# or directly:
curl -X POST localhost:3000/api/plates -H "Content-Type: application/json" -d '{"plate":"123-45-678"}'
```

(The dashboard also has a **📷 Simulate camera** button.)

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/plates` | Camera reports a car. Body: `{"plate":"123-45-678"}`. `201` ok, `400` invalid, `409` already inside / lot full |
| `GET`  | `/api/plates` | Cars inside, free spots, total entries, revenue, recent events |
| `POST` | `/api/plates/:plate/release` | Release a car and return its fee |
| `GET`  | `/api/health` | Health check |

## Our personal touch ✨

- **Theme:** Galactic Spaceport.
- **Parking fee:** every started hour costs ₪12 (`PRICE_PER_HOUR` in `docker-compose.yml`), calculated live per car.
- **Full Capacity Alert:** red flashing banner + capacity bar when the lot (8 bays) is full; new cars get rejected and logged.
- **"Release" button** per car - charges the fee and adds it to the revenue counter.
- **Dark Mode** button (remembered in the browser).
- **Easter egg:** on the dashboard type the Konami code: `↑ ↑ ↓ ↓ ← → ← → B A` 🛸

## Data persistence demo (Volume)

```bash
docker compose up -d
./camera-simulator/simulate.sh 111-11-111
docker compose down          # containers are removed, volume stays
docker compose up -d         # the car is still on the dashboard!
```

To wipe the data on purpose: `docker compose down -v`.

## CI/CD - GitHub Actions

Workflow: [`.github/workflows/docker-build.yml`](.github/workflows/docker-build.yml)

1. **`build` job - on every push / PR:** validates `docker-compose.yml`, runs `docker compose build`, starts the stack and runs a smoke test against the API and the web server.
2. **`publish` job (Bonus +10) - on push to `main` / tags `v*`:**
   - secure login to `ghcr.io` with the built-in `GITHUB_TOKEN`
   - automatic tags: `latest`, short commit SHA and the version (`v1.0.0` → `1.0.0`)
   - pushes `...-api` and `...-web` images to GitHub Container Registry

To publish a versioned release: `git tag v1.0.0 && git push origin v1.0.0`

## Project structure

```
.
├── docker-compose.yml
├── api/                  # Node.js API  (Dockerfile, server.js)
├── web/                  # Nginx + dashboard (Dockerfile, nginx.conf, index.html, app.js, style.css)
├── camera-simulator/     # script that imitates the IoT camera
├── .github/workflows/    # CI/CD
├── README.md
└── AI_USAGE.md
```

## Code review cheat sheet

- **Why `depends_on` + `healthcheck`?** So the API starts only after Redis answers `PING`.
- **Why does the API use `redis://redis:6379`?** Compose creates a network where each service name is a DNS name.
- **Why `--appendonly yes`?** Redis is in-memory; AOF writes every command to `/data/appendonlydir`, which is mounted to the `redis-data` volume.
- **Why `COPY package*.json` before `COPY server.js`?** Docker layer caching - dependencies are re-installed only when `package.json` changes.
- **Why Nginx proxies `/api/`?** The browser talks to a single origin (no CORS issues), and the API address stays internal.
- **Why a Redis ZSET for cars?** `plate → entry time` gives us sorting, O(1) duplicate check and a count in one structure.
