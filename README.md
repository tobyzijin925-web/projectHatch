# Hatch

Hatch is an AI-assisted marketplace prototype where clients describe work naturally and Hatch turns it into a clear project brief before posting it as a Hatch for Hatchers to review.

## Technology Stack

- Plain HTML, CSS, and JavaScript frontend
- Lightweight Node.js HTTP server in `server.js`
- DeepSeek API called only from the server side
- Browser storage for MVP demo state
- SQLite (Node's built-in `node:sqlite`, zero npm dependencies) for the hatch sync backend in `hatchApi.js` + `db.js`
- No payments or production upload storage yet (a stub `payments` table and a state-transition hook are in place for later)

## Local Setup

1. Clone the repository.
2. Create a local environment file:

```bash
cp .env.example .env.local
```

3. Open `.env.local` and add your real DeepSeek key:

```bash
DEEPSEEK_API_KEY=your_real_key_here
```

Never commit `.env`, `.env.local`, or any real API key.

### Free-tier testing without DeepSeek credit

DeepSeek requires prepaid balance to serve API requests. To test the real AI-assisted flow for free instead, use [Groq](https://console.groq.com/keys) (free API keys, OpenAI-compatible):

```bash
GROQ_API_KEY=your_groq_key_here
AI_PROVIDER=groq
```

`AI_PROVIDER=groq` is required if a `DEEPSEEK_API_KEY` is also present in `.env.local`, since DeepSeek is preferred by default when both are set. Remove that line (or unset `AI_PROVIDER`) to switch back to DeepSeek later.

Even without any key configured, the frontend keeps working: `aiController.js` automatically falls back to a local, rule-based brief generator whenever the AI request fails, so the hatch posting/browsing/claiming flow is fully testable with zero setup.

## Run Locally

Use Node.js to start the local server:

```bash
node server.js
```

Then open:

```text
http://127.0.0.1:8132/
```

The frontend can be opened directly as a file for static preview, but the AI assistant needs the local server so the DeepSeek key stays on the backend.

## Hatch Sync API

`server.js` also serves a JSON API (backed by SQLite in `data/hatch.db`, created automatically) so hatches can be posted, seen, and claimed across users. Requires Node 22.5+ for `node:sqlite`.

Auth endpoints return a bearer token; send it as `Authorization: Bearer <token>`:

- `POST /api/auth/signup` — `{username, name, email, password, role?}`
- `POST /api/auth/login` — `{usernameOrEmail, password}`
- `GET /api/auth/me`, `POST /api/auth/logout`

Hatch lifecycle (states: `open → claimed → in_progress → submitted → completed`, plus `disputed` / `cancelled`; responses carry both the machine `state` and the frontend `status` label such as "New Hatch"/"Incubating"/"Hatched"):

- `POST /api/hatches` — create (client). Accepts the same field names the frontend uses (`title`, `objective`, `budget`, `deliverables`, ...).
- `GET /api/hatches` — list; `?state=open` is the default, `?state=all` for everything, `?mine=created|claimed` with auth.
- `GET /api/hatches/:id` — detail with the event timeline; participants also see submissions.
- `POST /api/hatches/:id/claim` — Hatcher claims. Race-safe: exactly one simultaneous claimer wins.
- `POST /api/hatches/:id/start` — claimed → in_progress (claimer only).
- `POST /api/hatches/:id/submit` — `{message, attachments?}` deliverable (claimer only).
- `POST /api/hatches/:id/review` — `{decision: "approve"|"reject", feedback?}` (creator only). Approve completes the hatch; reject sends it back to in_progress.
- `POST /api/hatches/:id/cancel`, `POST /api/hatches/:id/dispute` — for the client / either party.

Allowed state transitions are enforced in the database (a transitions table plus a trigger), and every change is recorded in `hatch_events`. Run the API tests with:

```bash
node --test test/api.test.js
```

## API Key Safety

Private API keys must never be placed in frontend JavaScript, HTML, CSS, README files, screenshots, or Git commits.

The browser calls local API routes such as `/api/project-intake` and `/api/project-assistant`. The server reads `DEEPSEEK_API_KEY` from the local environment and forwards requests to DeepSeek.

## Collaboration Workflow

Keep the GitHub repository private. Do not share personal GitHub passwords or API keys with collaborators. Add collaborators through GitHub repository access with the minimum permission they need, usually write access.

Recommended branch names:

- `frontend/...`
- `backend/...`
- `feature/...`
- `fix/...`

Suggested workflow:

1. Create a feature branch from `main`.
2. Make focused changes.
3. Commit with a clear message.
4. Push the branch.
5. Open a pull request into `main`.
6. Review before merging.

If your GitHub plan and permissions allow it, protect `main` so changes require pull requests.

## Collaborator Commands

Replace the repository URL if your GitHub remote changes:

```bash
git clone https://github.com/tobyzijin925-web/Hatch.git
cd Hatch
cp .env.example .env.local
git checkout -b backend/deepseek-api
# make backend changes
git add .
git commit -m "Improve Hatch backend API"
git push -u origin backend/deepseek-api
```

The collaborator should add their own local `DEEPSEEK_API_KEY` to `.env.local`. They should not ask you to send your key through chat or commit it to GitHub.

## Assumptions and Limitations

- This is still an MVP prototype.
- Uploaded files are represented with local browser metadata for preview; there is no production file storage yet.
- Authentication is local/demo-oriented, not a secure production auth system.
- The DeepSeek integration is safe for local collaboration only when the API key stays in `.env.local` or a secure deployment environment variable.
