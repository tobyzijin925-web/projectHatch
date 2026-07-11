# Hatch

Hatch is an AI-assisted marketplace prototype where clients describe work naturally and Hatch turns it into a clear project brief before posting it as a Hatch for Hatchers to review.

## Technology Stack

- Plain HTML, CSS, and JavaScript frontend
- Lightweight Node.js HTTP server in `server.js`
- DeepSeek API called only from the server side
- Browser storage for MVP demo state
- No database, login backend, payments, or production upload storage yet

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
