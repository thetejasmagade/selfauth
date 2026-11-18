---
title: Choose your stack
description: Decide which backend, database and frontend to generate with selfauth init. A decision guide with a comparison of Express, Fastify and Gin and of each database.
keywords: [express vs fastify, gin, postgresql, sqlite, mysql, mongodb, vue, react, choose database]
---

# Choose your stack

`selfauth init` asks for three things: a backend, a database and a frontend. There's no switch to flip later, so it's worth a minute to think about them now. If you do change your mind, generate a fresh project and move your own files across.

## 1. Backend

| Backend | Language | Choose it when | Notes |
| --- | --- | --- | --- |
| Express 5 | TypeScript | You know Express, or you have no preference | The reference implementation. Default. |
| Fastify 5 | TypeScript | You prefer Fastify | Same core and behavior as Express, with a Fastify adapter. |
| Gin | Go 1.26+ | Your team writes Go | A Go port of the same core. API only, new projects only, PostgreSQL or in-memory. |

All three backends pass the same 90 conformance cases.

## 2. Database

```mermaid
flowchart TD
  start([Which database?]) --> trying{"Just trying it out?"}
  trying -- yes --> mem["memory"]
  trying -- no --> server{"Can you run a database server?"}
  server -- "no: one small server, one host" --> sqlite["sqlite"]
  server -- yes --> have{"Already use one?"}
  have -- PostgreSQL --> pg["postgresql"]
  have -- MySQL or MariaDB --> my["mysql"]
  have -- MongoDB --> mongo["mongodb"]
  have -- none --> pg
```

| Database | Choose it when | Limits |
| --- | --- | --- |
| `postgresql` | Real use, several app servers. Recommended. | None |
| `mysql` | You already run MySQL 8 or MariaDB | Claimed at "authorization level" until its production profile is reviewed |
| `sqlite` | One server, no database to operate | One file on one host. Not for several app instances |
| `mongodb` | You already run MongoDB | Claimed at "authorization level" until its production profile is reviewed. Uses indexes, not migrations |
| `memory` | A first look, demos, tests | Data is lost on restart. Refused in production. |

## 3. Frontend

| Option | You get |
| --- | --- |
| `none` | An API only. Use this when you already have a frontend, or are building a mobile app or another service. |
| `vue` | A Vue 3 + Vite app in `client/` with every account screen. |
| `react` | A React + Vite app in `client/` with every account screen. |

Gin doesn't generate a frontend, but a Vue or React app from `init --frontend` or `add-frontend` works fine against it. See [Frontend deployment](/configuration/frontend-deployment).

## A sensible first choice

```bash
npx selfauth init my-app --backend express --database memory --frontend vue
```

That gives you Express, no database to install, and a complete app with screens. When you're ready for a real database, [Change the database](/build/database-changes) shows how.
