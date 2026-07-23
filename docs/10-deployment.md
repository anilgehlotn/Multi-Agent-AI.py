# 10. Deployment

## 10.1 Local development setup

Prerequisites: Python 3.12 specifically (not 3.14 — see [12.10](./12-known-issues-and-gotchas.md#1210-chromadb-has-no-wheels-for-python-314)), Node 20+, Docker (optional, only needed for [10.2](#102-docker)).

**Backend:**
```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env — fill in GROQ_API_KEY, GOOGLE_API_KEY, TAVILY_API_KEY, JWT_SECRET_KEY
uvicorn main:app --reload
# → http://localhost:8000
```
`--reload` watches for file changes and restarts the server automatically — convenient for development, never used in the production `CMD` (see [10.2.1](#1021-the-backend-dockerfile-line-by-line)). The app will refuse to start (`raise SystemExit(1)`) if `GROQ_API_KEY`, `GOOGLE_API_KEY`, or `TAVILY_API_KEY` is missing from `.env` — see `validate_environment()` in [4.1](./04-backend-walkthrough.md#41-mainpy).

**Frontend**, in a second terminal:
```bash
cd frontend
npm install
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:8000 (the default, already correct for local dev)
npm run dev
# → http://localhost:5173
```

Both servers need to be running simultaneously for the app to actually work end to end — the frontend is a pure client that talks to the backend over HTTP; there's no server-side rendering or proxying between them in local dev.

## 10.2 Docker

### 10.2.1 The backend Dockerfile, line by line

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# chromadb / onnxruntime need libgomp1 on Debian.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Separate layer so `pip install` is only re-run when requirements.txt changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Data/db dirs are created (and owned by `app`) before the volumes mount over
# them, so Docker seeds the named volumes with the right ownership on first run.
RUN useradd --create-home --shell /bin/bash app \
    && mkdir -p /app/data /app/db_data \
    && chown -R app:app /app

USER app

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
```
- **`python:3.12-slim`** — the `slim` variant is a much smaller Debian base than the full `python:3.12` image (which bundles a large set of build tools and libraries this project doesn't need), while still being Debian (not Alpine) — Alpine's `musl` libc has historically caused compatibility headaches with compiled Python packages (like `onnxruntime`, a `chromadb` dependency) that ship prebuilt wheels expecting `glibc`. `slim` was chosen as the smallest base that doesn't fight the dependency stack.
- **`libgomp1`** — `chromadb` pulls in `onnxruntime` as a transitive dependency, and `onnxruntime`'s prebuilt Linux wheels are linked against `libgomp` (GNU OpenMP's runtime library, used for parallelized numeric operations) — without it installed, `onnxruntime` fails to import at all. It's not part of the `python:3.12-slim` base image, so it has to be installed explicitly.
- **Layer ordering** — `COPY requirements.txt .` and `RUN pip install ...` happen *before* `COPY . .` (the rest of the source code), specifically so Docker's layer cache is invalidated only when `requirements.txt` actually changes. Since `pip install` is the single most time-consuming step in this build (installing the full LangChain/ChromaDB/etc. dependency tree), this ordering means a pure code change (no new dependencies) rebuilds in seconds via cache instead of minutes.
- **The non-root `app` user** — running a container process as root is a real, avoidable security risk (a container escape or a code-execution vulnerability in the app is meaningfully worse if it lands you root inside the container). `useradd` creates an unprivileged user, `chown -R app:app /app` gives it ownership of everything the app needs to read/write, and `USER app` switches to it before the app actually starts. The `mkdir -p /app/data /app/db_data` *before* the `chown` matters specifically for the Docker Compose deployment: these two directories are volume-mount points ([10.2.3](#1023-docker-composeyml)), and Docker seeds a newly-created named volume with whatever was already at that path in the image — pre-creating them (owned by `app`) here means the volumes inherit correct, writable ownership on first mount, rather than showing up owned by `root` and causing permission errors for the `app` user at runtime.
- **`CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}`** — shell form (not the more common exec-form JSON-array `CMD [...]`), specifically so `${PORT:-8000}` gets expanded by the shell at container start. This binds to whatever `$PORT` the hosting platform injects (Render assigns a dynamic port, commonly `10000`), falling back to `8000` if `$PORT` isn't set (local `docker compose`, which explicitly maps `8000:8000`). See [10.3.2](#1032-the-port-binding-requirement-and-the-bug-it-caused) for the real deployment failure this line fixes.

### 10.2.2 The frontend Dockerfile — the two-stage build explained

```dockerfile
# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ---- runtime ----
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```
**Why two stages:** a React app's *build* environment (Node, `npm`, every dev dependency, the entire unbundled source tree) is completely unnecessary at *runtime* — the actual shipped artifact is a handful of static HTML/CSS/JS files. The `builder` stage does the compilation (`npm ci` for a reproducible install from the lockfile, then `npm run build`, which runs Vite's production build into `/app/dist`); the second stage starts completely fresh from a minimal `nginx:alpine` image and copies *only* the `dist/` output (`COPY --from=builder /app/dist ...`) into it. Everything from the builder stage — Node itself, `node_modules`, the source `.jsx` files — is discarded; none of it exists in the final image. This is why the frontend image (93 MB uncompressed via `docker images`, ~25 MB via the more accurate `docker image inspect` — see [12](./12-known-issues-and-gotchas.md) for the discrepancy) is dramatically smaller than the backend's.

**`ARG VITE_API_BASE_URL` + `ENV VITE_API_BASE_URL`:** Vite bakes environment variables prefixed `VITE_` into the built JavaScript bundle *at build time* — there's no runtime environment-variable reading happening in the browser (a static site served by nginx has no server-side process to read env vars from at request time at all). The `ARG` declares a build-time parameter (settable via `docker build --build-arg` or, as this project uses it, via `docker-compose.yml`'s `build.args`); re-exposing it as an `ENV` makes it visible to the `RUN npm run build` step's environment, which is where Vite actually reads it from. Change the backend's URL, and the frontend image must be *rebuilt* — not just restarted — for the new URL to take effect.

### 10.2.3 `docker-compose.yml`

```yaml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      - GROQ_API_KEY=${GROQ_API_KEY}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      - TAVILY_API_KEY=${TAVILY_API_KEY}
      - MISTRAL_API_KEY=${MISTRAL_API_KEY}
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - DATABASE_URL=sqlite:///./db_data/researchmind.db
    volumes:
      - backend_data:/app/data
      - backend_db:/app/db_data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_BASE_URL: http://localhost:8000
    ports: ["5173:80"]
    depends_on:
      backend:
        condition: service_healthy

volumes:
  backend_data:
  backend_db:
```
**`environment: [...=${VAR}]`** pulls each value from a `.env` file at the project root (Docker Compose auto-loads it) — this is a different `.env` file from `backend/.env` (used for local, non-Docker `uvicorn` runs); Compose's `${VAR}` substitution reads only the root-level one.

**`DATABASE_URL=sqlite:///./db_data/researchmind.db`** — a relative path that, per `_resolve_database_url()`'s logic ([4.3](./04-backend-walkthrough.md#43-dbdatabasepy)), resolves against `/app` (the container's `WORKDIR`, which is also where the backend code lives) — landing at `/app/db_data/researchmind.db`, which is exactly the `backend_db` volume's mount point below it. This is deliberately different from the plain `DATABASE_URL` default (`sqlite:///./researchmind.db`, which would resolve to `/app/researchmind.db` — *not* inside either mounted volume) — without this override, the database would live on the container's writable layer, and would be silently wiped every time the container is recreated, defeating the entire purpose of the volume.

**`volumes: backend_data:/app/data`, `backend_db:/app/db_data`** — named Docker volumes, managed by Docker itself (not bind-mounted host directories) — persist uploaded PDFs, Chroma indexes, and the SQLite file across `docker compose down`/`up` cycles (though not across `docker compose down -v`, which explicitly removes volumes too).

**`depends_on: backend: condition: service_healthy`** — the frontend container won't even *start* until the backend's `healthcheck` reports healthy, avoiding a race where the frontend serves a page whose first API call fails simply because the backend hadn't finished starting yet. This is a real mechanism with a real, currently-unresolved gap: the `healthcheck`'s `test` runs `curl` *inside* the backend container — and a later change (documented in [12.12](./12-known-issues-and-gotchas.md#1212-docker-compose-healthcheck-still-references-curl-now-removed-from-the-image)) removed `curl` from the backend image entirely as part of a dependency-trimming pass, without updating this healthcheck. It's flagged there, not fixed, as a known, honestly-documented gap.

## 10.3 Render deployment

### 10.3.1 `render.yaml`, field by field

```yaml
services:
  - type: web
    name: researchmind-backend
    runtime: docker
    dockerfilePath: ./backend/Dockerfile
    dockerContext: ./backend
    plan: free
    healthCheckPath: /health
    envVars:
      - key: GROQ_API_KEY
        sync: false
      - key: GOOGLE_API_KEY
        sync: false
      - key: TAVILY_API_KEY
        sync: false
      - key: MISTRAL_API_KEY
        sync: false
      - key: JWT_SECRET_KEY
        generateValue: true
      - key: DATABASE_URL
        value: sqlite:///./researchmind.db
      - key: CORS_ORIGINS
        sync: false
```
This is a Render **Blueprint** — infrastructure-as-code that Render reads automatically when you choose "New → Blueprint" and point it at this repo, rather than manually clicking through Render's web UI to configure a service by hand.

- **`type: web`** — an HTTP-serving service (as opposed to Render's `worker` or `cron` service types, which don't accept inbound requests).
- **`runtime: docker`** + **`dockerfilePath`/`dockerContext`** — tells Render to build from this project's own `backend/Dockerfile` rather than trying to auto-detect a buildpack; `dockerContext: ./backend` matters because the Dockerfile's `COPY requirements.txt .` and `COPY . .` are relative to that context directory, not the repo root.
- **`plan: free`** — Render's no-cost tier; see [10.3.3](#1033-free-tier-constraints-512mb-ram-no-persistent-disk-15min-sleep) for exactly what that trades away.
- **`healthCheckPath: /health`** — Render's *own* platform-level health check (distinct from, and unrelated to, the `docker-compose.yml` healthcheck discussed above) — it polls this path to decide whether a freshly-deployed instance is ready to receive traffic, and to decide whether a running instance should be considered unhealthy and restarted.
- **`sync: false`** on most `envVars` — tells Render "this variable is a secret; don't try to auto-populate or sync a value for it from this file, prompt for it in the dashboard instead" — this is the mechanism that keeps real API keys out of git while still declaring, in version control, *which* variables the service needs.
- **`generateValue: true`** on `JWT_SECRET_KEY` — Render generates a strong random value for this one automatically at first deploy, rather than requiring a human to think one up and paste it in.
- **`CORS_ORIGINS` with `sync: false`, no `value`** — deliberately left for the human to fill in *after* the frontend has its own URL (a chicken-and-egg problem: the backend needs to know the frontend's URL to allow it via CORS, but the frontend's URL doesn't exist until *it's* deployed) — see [10.5](#105-the-cors-handshake-between-the-two--why-its-a-separate-step).

### 10.3.2 The `$PORT` binding requirement (and the bug it caused)

Render (like most PaaS platforms) assigns each service a dynamic port at runtime via the `$PORT` environment variable and expects the process to bind to it — the platform's own load balancer/proxy forwards external traffic to whatever port the app actually reports listening on. This project's Dockerfile `CMD` originally used the exec-form array syntax with a hardcoded port:
```dockerfile
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```
Exec-form `CMD` does **not** invoke a shell, so `${PORT}` inside it would be passed to `uvicorn` completely literally (as the string `"${PORT}"`), not expanded. The app kept listening on `8000` regardless of what Render actually assigned as `$PORT` — Render's platform-level port scan, checking whether the app is listening on the port it was told to use, never found anything there, and the deploy timed out as unhealthy even though the container itself was running (and locally, listening exactly where it was told to). The fix was switching to shell-form `CMD` (no brackets — see [10.2.1](#1021-the-backend-dockerfile-line-by-line)), which *does* run through a shell, so `${PORT:-8000}` gets properly expanded before `uvicorn` ever sees it. Full incident writeup: [12.4](./12-known-issues-and-gotchas.md#124-render-port-binding).

### 10.3.3 Free-tier constraints: 512MB RAM, no persistent disk, 15-min sleep

Three real limits that shaped multiple decisions across this project (cross-referenced throughout these docs, collected here in one place):

- **512 MB RAM hard cap** — exceed it and the container is OOM-killed by the platform, not gracefully throttled. This is what originally forced the removal of `sentence-transformers`/`torch` from the dependency tree (see [11.13](./11-design-decisions.md#1113-removing-torchsentence-transformers)) — idle RAM went from roughly 800 MB (over the cap, guaranteed OOM) to about 160 MB (comfortably under it) as a direct result.
- **No persistent disk** — every redeploy (a git push, a manual redeploy, or a Render-initiated restart) wipes the container's writable filesystem entirely, including the SQLite database file and any indexed Chroma directories. This is why `render.yaml`'s `DATABASE_URL` points at a plain in-container path (`sqlite:///./researchmind.db`), *not* the volume-backed path `docker-compose.yml` uses — there is no equivalent of a Docker named volume on Render's free tier to point it at. Explicitly accepted as fine for a demo link, explicitly not fine for anything real — see [1.4](./01-project-overview.md#14-what-its-not).
- **15-minute sleep** — a free-tier service with no incoming traffic for 15 minutes is put to sleep entirely; the next request has to wait for a cold start (observed at roughly 30–60 seconds) before it's served. This is why `main.py` has a `/warmup` endpoint (`{"status": "warm", "timestamp": ...}`, does no real work) — intended to be hit by the frontend proactively, absorbing the cold-start latency before a user's *first real* action needs a response. (As of this writing, the frontend doesn't actually call it on load yet — the endpoint exists and works, but isn't wired into the UI's mount lifecycle. A real, honestly-flagged gap, not a claim that it's fully wired up.)

### 10.3.4 Environment variables and `sync: false`

Covered above in [10.3.1](#1031-renderyaml-field-by-field) — repeating the practical workflow: after `render.yaml` creates the service via Blueprint, every `sync: false` variable shows up as an empty field in the Render dashboard's Environment tab, and the service will fail its startup validation (`validate_environment()` in `main.py`) until real values are filled in for `GROQ_API_KEY`, `GOOGLE_API_KEY`, and `TAVILY_API_KEY` specifically (`MISTRAL_API_KEY` is optional — nothing in the live code path requires it; `CORS_ORIGINS` isn't checked at startup at all, but the app is effectively unusable from a browser without it set correctly).

## 10.4 Vercel deployment

### 10.4.1 `vercel.json`, the SPA rewrite, and why it's needed for react-router

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "rewrites": [
    { "source": "/(.*)", "destination": "/" }
  ]
}
```
The `rewrites` rule is the load-bearing part. `react-router-dom`'s client-side routing means a URL like `/history/research/42` is handled entirely *inside* the already-loaded JavaScript app — there is no server-side route for it. But if a user directly navigates to (or refreshes on, or bookmarks) that URL, the *browser* makes a real HTTP request for `/history/research/42` to Vercel's static file server first, before any of the app's JavaScript has had a chance to run. Without the rewrite, Vercel would look for a literal file at that path, find nothing, and return a 404 — because nothing in the static build actually has a file at that path; it's a route the *client-side router* understands, not the file server. The rewrite rule (`"source": "/(.*)"` — match everything — `"destination": "/"` — serve `index.html` instead) means every URL, no matter what it looks like, gets served the same `index.html` shell, which then boots the React app, which then reads the *actual* URL from the browser (`window.location`) and lets `react-router-dom` render the right page client-side. This is the standard fix for every client-side-routed single-page app on every static host, not something specific to this project.

### 10.4.2 Build-time env var injection (`VITE_` prefix)

Same mechanism as the Docker build ([10.2.2](#1022-the-frontend-dockerfile--the-two-stage-build-explained)) — Vite only exposes environment variables prefixed `VITE_` to the built JavaScript (`import.meta.env.VITE_API_BASE_URL`), and only variables present at *build* time, not at serve time. On Vercel, this means setting `VITE_API_BASE_URL` in the Vercel dashboard's Environment Variables panel (pointed at the Render backend's URL) *before* triggering a build — changing it later requires a new deploy (a rebuild) to actually take effect, exactly as with the Docker build.

## 10.5 The CORS handshake between the two — why it's a separate step

CORS (Cross-Origin Resource Sharing) is a browser-enforced security mechanism: a webpage served from origin A (`https://multi-agent-ai-py.vercel.app`) is, by default, forbidden from making requests to a different origin B (`https://researchmind-backend-xxxx.onrender.com`) unless origin B's server explicitly says, in its response headers, "requests from A are allowed." This project's backend implements that allow-list via `CORS_ORIGINS` (a comma-separated env var, parsed in `main.py` — see [4.1](./04-backend-walkthrough.md#41-mainpy)).

The reason this can't be a single one-shot deploy: the backend needs to know the frontend's *actual* Vercel URL to allow it — but that URL doesn't exist until the frontend has already been deployed once. So the real sequence is necessarily: deploy backend (get its URL) → deploy frontend, configured with that backend URL (get *its* URL) → go back and set `CORS_ORIGINS` on the backend to the frontend's URL → redeploy the backend one more time for that env var change to take effect. Skipping the last step is a very easy mistake to make and produces a confusing symptom — both services are individually up and healthy, `curl`-able, working — but the deployed frontend's API calls fail in the browser with a CORS error, because the backend simply hasn't been told to allow that origin yet.

## 10.6 Environment variables: complete table

| Variable | Used by | Purpose | Where to get it | Required? |
|---|---|---|---|---|
| `GROQ_API_KEY` | Backend (`ChatGroq`, everywhere) | All chat/agent/judge LLM calls | console.groq.com/keys | Yes — checked at startup |
| `GOOGLE_API_KEY` | Backend (`GoogleGenerativeAIEmbeddings`) | All embedding calls (RAG indexing + querying) | Google AI Studio | Yes — checked at startup |
| `TAVILY_API_KEY` | Backend (`web_search` tool) | Research pipeline's web search | tavily.com | Yes — checked at startup |
| `MISTRAL_API_KEY` | Backend (unused by any live route) | Only referenced by a standalone demo script (`rag/retrievers/`), not the live API | mistral.ai | No |
| `JWT_SECRET_KEY` | Backend (`auth/security.py`) | Signs/verifies auth tokens | Generate: `python -c "import secrets; print(secrets.token_urlsafe(32))"` (or `generateValue: true` on Render) | Yes — app fails to boot without it, no default |
| `JWT_ALGORITHM` | Backend | JWT signing algorithm | Default `HS256`, rarely needs changing | No |
| `JWT_EXPIRE_MINUTES` | Backend | Token lifetime | Default 10080 (7 days) | No |
| `DATABASE_URL` | Backend | SQLAlchemy connection string | Default `sqlite:///./researchmind.db`; overridden per-deployment-target ([10.2.3](#1023-docker-composeyml), [10.3.1](#1031-renderyaml-field-by-field)) | No (has a default) |
| `CORS_ORIGINS` | Backend | Comma-separated allowed frontend origins | Default covers local dev; must be set to the real frontend URL in production ([10.5](#105-the-cors-handshake-between-the-two--why-its-a-separate-step)) | Effectively yes, in production |
| `VITE_API_BASE_URL` | Frontend (build-time) | Which backend the frontend talks to | The backend's URL — `http://localhost:8000` locally, the Render URL in production | Yes — baked in at build time |

---

**Next:** [11-design-decisions.md](./11-design-decisions.md) for the "why" behind every one of these choices, collected in one place.
