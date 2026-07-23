# ResearchMind Documentation

ResearchMind is a web application with two independent AI systems behind one interface — a four-agent pipeline that researches any topic end-to-end (search, read, write, critique) and a RAG-based PDF Q&A tool that answers questions strictly from an uploaded document — plus an evaluation module that measures both systems' real output quality against a fixed, hand-built test set using an LLM judge, with results visible in the app itself. This folder documents the whole system in depth: what it is, why every non-obvious decision was made, how every part of the code works, and how to extend it safely.

Every document uses a strict numbered hierarchy (1, 1.1, 1.1.1, ...) so any section can be referenced precisely — "see 6.3.2" always means the same thing everywhere in this folder.

## Start here — by what you're trying to do

**"I want to understand this project"** — read in order: [01-project-overview.md](./01-project-overview.md) → [02-concepts-primer.md](./02-concepts-primer.md) → [03-architecture.md](./03-architecture.md), then dive into whichever system doc interests you most ([05](./05-research-pipeline.md), [06](./06-rag-system.md), [07](./07-evaluation-module.md)).

**"I want to contribute a feature"** — read [03-architecture.md](./03-architecture.md) and [13-extending-this-project.md](./13-extending-this-project.md) first, then the specific module doc for whatever you're touching ([04](./04-backend-walkthrough.md), [05](./05-research-pipeline.md), [06](./06-rag-system.md), [07](./07-evaluation-module.md), [08](./08-auth-system.md), or [09](./09-frontend-walkthrough.md)).

**"I want to run it locally"** — read the root [README.md](../README.md) first, then [10-deployment.md](./10-deployment.md) for the full setup, Docker, and cloud-deployment detail.

**"I have no AI/ML background and every term is new to me"** — [02-concepts-primer.md](./02-concepts-primer.md) is written specifically for you; it defines everything (LLM, embedding, vector database, RAG, agent, and more) from zero, with this project's actual code as the running example.

## Full index

| # | Doc | Covers |
|---|---|---|
| 1 | [01-project-overview.md](./01-project-overview.md) | What this project is, what problems it solves, the tech stack and why each piece was chosen, scope boundaries |
| 2 | [02-concepts-primer.md](./02-concepts-primer.md) | **Start here if new to AI.** LLMs, prompts, embeddings, vector databases, RAG, retrieval strategies, agents, chains, evaluation — every concept, defined from zero, tied to this project's real code |
| 3 | [03-architecture.md](./03-architecture.md) | The system diagram, three full request-lifecycle walkthroughs, the data model, why background tasks + polling, where every piece of state lives |
| 4 | [04-backend-walkthrough.md](./04-backend-walkthrough.md) | File-by-file tour of `backend/` — what each file does, the real code, what would break if you changed it |
| 5 | [05-research-pipeline.md](./05-research-pipeline.md) | The 4-agent research pipeline in depth — every stage, every prompt dissected clause by clause, orchestration, how to extend it |
| 6 | [06-rag-system.md](./06-rag-system.md) | The RAG PDF Q&A system in depth — indexing, querying, session lifecycle, failure modes (including the ones that fail silently), how to extend it |
| 7 | [07-evaluation-module.md](./07-evaluation-module.md) | The LLM-as-judge evaluation system — datasets, judges, every metric defined precisely, the live-first/cached-fallback run harness, how to read a real scorecard |
| 8 | [08-auth-system.md](./08-auth-system.md) | The JWT auth system — what's built, why it's not wired to the frontend yet, password hashing, tokens, security notes, how to wire it up |
| 9 | [09-frontend-walkthrough.md](./09-frontend-walkthrough.md) | The React frontend — routing, the API client, the polling hook, every component, state management patterns |
| 10 | [10-deployment.md](./10-deployment.md) | Local setup, Docker (line by line), Render, Vercel, the CORS handshake between them, every environment variable |
| 11 | [11-design-decisions.md](./11-design-decisions.md) | The "why" document — 15 major decisions, each with the context, alternatives considered, tradeoff accepted, and what would change it |
| 12 | [12-known-issues-and-gotchas.md](./12-known-issues-and-gotchas.md) | Honest, specific list of real bugs and platform quirks hit during development — symptom, root cause, fix, how to recognize it again |
| 13 | [13-extending-this-project.md](./13-extending-this-project.md) | Conventions, the local dev loop, numbered walkthroughs for 8 common extensions, sharp edges to watch for |
| 14 | [14-glossary.md](./14-glossary.md) | Every technical term used anywhere in this project, alphabetical, one or two sentences each |

## Map: which doc covers which part of the repo

| Repo path | Primarily documented in |
|---|---|
| `backend/main.py`, `backend/config.py` | [04.1](./04-backend-walkthrough.md#41-mainpy), [04.2](./04-backend-walkthrough.md#42-configpy) |
| `backend/db/` | [03.3](./03-architecture.md#33-the-data-model), [04.3](./04-backend-walkthrough.md#43-dbdatabasepy)–[04.4](./04-backend-walkthrough.md#44-dbmodelspy) |
| `backend/agents/`, research pipeline orchestration | [05](./05-research-pipeline.md), [04.5](./04-backend-walkthrough.md#45-agentstoolspy)–[04.7](./04-backend-walkthrough.md#47-agentspipelinepy) |
| `backend/research/` | [04.8](./04-backend-walkthrough.md#48-researchschemaspy)–[04.10](./04-backend-walkthrough.md#410-researchrouterpy), [05](./05-research-pipeline.md), [03.2.1](./03-architecture.md#321-user-submits-a-research-topic) |
| `backend/rag_api/`, `backend/rag/` | [06](./06-rag-system.md), [04.11](./04-backend-walkthrough.md#411-rag_apischemaspy)–[04.13](./04-backend-walkthrough.md#413-rag_apirouterpy), [03.2.2](./03-architecture.md#322-user-uploads-a-pdf-and-asks-a-question) |
| `backend/evals/` | [07](./07-evaluation-module.md), [04.14](./04-backend-walkthrough.md#414-evalsrouterpy), [03.2.3](./03-architecture.md#323-user-opens-the-evals-page) |
| `backend/auth/` | [08](./08-auth-system.md), [04.15](./04-backend-walkthrough.md#415-auth) |
| `frontend/src/` (all of it) | [09](./09-frontend-walkthrough.md) |
| `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` | [10.2](./10-deployment.md#102-docker) |
| `render.yaml` | [10.3](./10-deployment.md#103-render-deployment) |
| `frontend/vercel.json` | [10.4](./10-deployment.md#104-vercel-deployment) |
| Every design tradeoff, across the whole repo | [11](./11-design-decisions.md) |
| Every real bug/quirk hit during development | [12](./12-known-issues-and-gotchas.md) |

## A note on how to read this

Every concept, the first time it's used anywhere in this folder, is either defined inline or links to its definition in [02-concepts-primer.md](./02-concepts-primer.md) or [14-glossary.md](./14-glossary.md) — you should never hit an undefined term and have to go looking for it elsewhere. Code quoted in these docs is real, copied directly from this repository at the time of writing, not paraphrased or simplified pseudocode — if the code has since changed, trust the actual file over the doc, and treat the mismatch as a sign these docs need a refresh for that section.
