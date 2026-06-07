# RSS Summary Reader

Express, PostgreSQL, and a small static frontend for collecting RSS articles, filtering by source, and browsing topic-style views.

## Features

- Manage RSS feeds from the browser
- Fetch articles into PostgreSQL
- Filter by feed source
- Filter across all sources by topic keywords
- Optional OpenAI-based article summarization endpoints

## Requirements

- Node.js 20 or later
- npm
- Docker, for local PostgreSQL via Docker Compose

## Local Setup

Start PostgreSQL:

```bash
docker compose up -d
```

Install dependencies:

```bash
npm install
```

Start the app:

```bash
DATABASE_URL=postgres://rss:rss@localhost:5432/rss_reader npm run start
```

Open:

```text
http://localhost:3000
```

The app creates the `feeds` and `articles` tables on startup. It starts with an empty database; add feeds in the UI or through `POST /feeds`, then run `POST /fetch-rss`.

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `PORT` | No | Port for the HTTP server. Render sets this automatically. Defaults to `3000`. |
| `OPENAI_API_KEY` | Only for summarization | Required for `/summarize-test`, `/summarize-pending`, and re-summarization endpoints. |
| `OPENAI_MODEL` | No | Model name for summarization. Defaults to the value in `index.js`. |

Local example:

```text
DATABASE_URL=postgres://rss:rss@localhost:5432/rss_reader
```

## API Checks

```bash
curl -X POST http://localhost:3000/feeds \
  -H 'Content-Type: application/json' \
  -d '{"name":"GIGAZINE","url":"https://gigazine.net/news/rss_2.0/"}'

curl -X POST http://localhost:3000/fetch-rss
curl 'http://localhost:3000/articles?limit=20'
curl 'http://localhost:3000/articles?topic=AI&limit=20'
```

## Render Deployment

This project now uses Render Postgres. Persistent Disk is not required.
The included `render.yaml` uses Render's Free instance types for both the web service and Postgres. Free Render Postgres is suitable for testing and hobby use, but has Render's current free-tier limitations, including a 30-day database limit.

### Option A: Blueprint

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Render reads `render.yaml` and creates:
   - A Node web service
   - A Render Postgres database
   - `DATABASE_URL` wired from the database connection string
4. Set `OPENAI_API_KEY` manually if you use summarization.

Blueprint settings:

```text
Runtime: Node
Build Command: npm install
Start Command: npm run start
Web Service Plan: Free
Database: Render Postgres Free
Environment:
  NODE_ENV=production
  DATABASE_URL=(from Render Postgres)
  OPENAI_API_KEY=(optional)
  OPENAI_MODEL=(optional)
```

### Option B: Manual Web Service

1. Create a Render Postgres database.
2. Create a new Render Web Service from the GitHub repository.
3. Use these settings:

```text
Runtime: Node
Build Command: npm install
Start Command: npm run start
```

4. Add environment variables:

```text
NODE_ENV=production
DATABASE_URL=<Render Postgres Internal Database URL>
OPENAI_API_KEY=(optional; only needed for summarization)
OPENAI_MODEL=(optional; only needed to override the default summarization model)
```

## GitHub Push

Replace `<YOUR_GITHUB_REPO_URL>` with your repository URL.

```bash
git init
git add .
git commit -m "Migrate RSS reader to PostgreSQL"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```
