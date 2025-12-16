# Copilot Instructions for `antic-liveauthorranking`

This repository tracks and ranks "Create" mod authors based on CurseForge download stats. It consists of a Node.js backend (native `http`) and a vanilla JavaScript frontend.

## 🏗 Project Architecture

### Backend (`src/`, `util/`)
- **Server**: `src/index.mjs` is a lightweight, dependency-free HTTP server (no Express). It serves static files from `public/` and JSON API endpoints from `data/`.
- **Data Collection**: `util/updatesingle.mjs` is the primary script for fetching data from the CurseForge API. It handles:
  - Fetching mod data with pagination and rate limiting.
  - Filtering for "Create" category or related mods.
  - Archiving historical data to `data/archive/`.
  - Calculating stats (download rates) and updating `data/mods.json` and `data/authors.json`.
- **Notifications**: `util/discordNotifier.mjs` handles Discord webhook integrations.

### Frontend (`public/`)
- **Vanilla JS**: No build step or framework (React/Vue/etc.).
- **Visualization**: Uses D3-like logic (custom implementation) for charts in `public/bubble-chart/`, `public/pie-chart.js`, etc.
- **Entry Point**: `public/index.html` loads the visualization scripts.

### Data Flow
1. **Ingest**: `util/updatesingle.mjs` fetches raw data from CurseForge.
2. **Process**: Data is cleaned, aggregated by author, and stats are calculated.
3. **Store**: Results are saved to `data/mods.json` and `data/authors.json`.
4. **Serve**: `src/index.mjs` exposes these files via `/api/mods` and `/api/authors`.
5. **Consume**: Frontend fetches these endpoints to render charts.

## 🛠 Critical Workflows

- **Run Server**: `node src/index.mjs` (starts on port 8080).
- **Update Data**: `node util/updatesingle.mjs` (or run `update.sh`).
  - **Requires**: `.env` file with `CURSEFORGE_TOKEN`.
- **Docker**: `docker build -t author-ranking .` -> `docker run -p 8080:8080 -v $(pwd)/data:/data author-ranking`.

## 📝 Conventions & Patterns

- **ES Modules**: Use `.mjs` extension for backend, `.js` for frontend and native `import`/`export`.
- **Native HTTP**: Do not introduce Express or other server frameworks. Keep `src/index.mjs` simple.
- **Rate Limiting**: Respect CurseForge API limits. See `logRateLimitHeaders` in `util/updatesingle.mjs`.
- **Data Archiving**: Preserve historical data in `data/archive/` with `YYYY-MM-DD` suffixes before overwriting current files.
- **Frontend**: Keep it vanilla. Use `fetch` for API calls. CSS goes in `public/style.css`.

## ⚠️ Integration Points

- **CurseForge API**: The core dependency. Ensure `CURSEFORGE_TOKEN` is valid.
- **Discord Webhooks**: Used for ranking updates.
- **File System**: The "database" is just JSON files in `data/`. Ensure atomic writes or handle locking if concurrency becomes an issue (currently single-threaded update script).
