# Voice Agent Studio

Voice Agent Studio is a visual workspace for designing, deploying, and monitoring realtime voice agents without editing flow definitions by hand.

## Quick Start

The local stack includes PostgreSQL, database migrations, Runtime, Research Agent, and Studio.

```bash
test -f .env || cp .env.example .env
npm run local:up
```

Open [http://localhost:4173](http://localhost:4173). Runtime and Research Agent are available at ports `8080` and `8081`.

```bash
npm run local:logs   # Follow service logs
npm run local:down   # Stop services
```

Replace `RUNTIME_SECRET_KEY` in `.env` before storing provider credentials. PostgreSQL data is kept in a named Docker volume when the stack is stopped. The repository does not seed a default workspace or bundled domain-specific data, so a new database starts empty.

Run the local quality checks before committing changes:

```bash
npm run lint
npm run format:check
npm test
npm run runtime:test
npm run research:test
```

## Production Deployment

Build each service image from the repository root:

```bash
docker build -f deploy/Dockerfile.runtime -t voice-agent-studio-runtime:latest .
docker build -f deploy/Dockerfile.research -t voice-agent-studio-research:latest .
docker build -f deploy/Dockerfile.studio \
  --build-arg VITE_RUNTIME_API_URL=https://runtime.example.com \
  --build-arg VITE_RESEARCH_API_URL=https://research.example.com \
  -t voice-agent-studio:latest .
```

Use `.env.production.example` as the deployment configuration reference. Inject `DATABASE_URL` and `RUNTIME_SECRET_KEY` through the platform's secret manager, and provide the remaining server variables through its environment configuration. `VITE_RUNTIME_API_URL` and `VITE_RESEARCH_API_URL` are public build arguments embedded in the Studio bundle and must not contain secrets.

Runtime and Research Agent must share the same database and `RUNTIME_SECRET_KEY`. Configure `RESEARCH_AGENT_URL` with the Research Agent's internal service URL and restrict `STUDIO_ORIGINS` to the deployed Studio origin.

Python Code Actions are disabled by default with `ALLOW_UNSAFE_CODE_ACTIONS=false`. The current subprocess isolation is not a production security sandbox; enable it only in a trusted local environment until an isolated worker is available.

Run migrations as a one-off deployment job before starting the application services:

```bash
alembic -c /app/alembic.ini upgrade head
```

No production Compose file is included. The Dockerfiles are intended for a container platform such as Kubernetes, ECS, Cloud Run, or an equivalent service that manages networking, health checks, restarts, secrets, and scaling.

## Architecture

| Service        | Responsibility                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Studio         | React application for workspace configuration, visual flow editing, deployments, calls, and reports                                 |
| Runtime        | FastAPI service that persists Studio documents and runs deployed voice-agent flows through Twilio Media Streams and OpenAI Realtime |
| Research Agent | FastAPI service that performs post-call assessment scoring and transcript-grounded analysis                                         |
| PostgreSQL     | Shared storage for workspace documents, encrypted provider settings, deployments, calls, and reports                                |

Studio communicates with Runtime and Research Agent over HTTP. Runtime requests post-call analysis from Research Agent, and both backend services use the same PostgreSQL database. Workspace documents and encrypted provider secrets are stored separately; secret values are never returned to the browser after they are saved.

```text
Browser
  └─ Studio
      ├─ Runtime ──────── PostgreSQL
      │    └─ Twilio / OpenAI Realtime
      └─ Research Agent ─ PostgreSQL
               └─ OpenAI Responses API
```

## Using Voice Agent Studio

Create a workspace and configure its Twilio and OpenAI connections in Settings. Provider credentials are encrypted by Runtime using `RUNTIME_SECRET_KEY`. Set `PUBLIC_URL` to an HTTPS address reachable by Twilio, such as a deployed Runtime URL or an ngrok URL during local testing.

Within a workspace, create one or more agents and build each conversation as a visual graph of Start, Node, Tool, and End blocks. Nodes can collect structured values, invoke registered tools, produce audio responses, and transition through conditional, fallback, or timeout edges. Workspace-level assessments, policies, knowledge, contacts, functions, and state are managed in Studio and stored in PostgreSQL.

Validate the graph before creating a deployment. A deployment captures the executable flow and its referenced data assets so Runtime can execute a stable version independently from later draft edits. Calls and transcripts are available for operational review, while eligible completed calls can be analyzed by Research Agent and reviewed from the Reports page.

## License

Copyright 2026 skan0779. Licensed under the [Apache License 2.0](LICENSE).
