---
title: Choose your stack
description: Decide which backend, database and frontend to generate with selfauth init. A decision guide with a comparison of Express, Fastify and Gin and of each database.
keywords: [express vs fastify, gin, postgresql, sqlite, mysql, mongodb, vue, react, choose database]
---

# Choose your stack

`selfauth init` asks three questions: which backend, which database, which frontend. You can change your mind later by generating another project, but not by flipping a switch, so choose now.

## 1. Backend

| Backend | Language | Choose it when | Notes |
| --- | --- | --- | --- |
| Express 5 | TypeScript | You know Express, or you have no preference | The reference implementation. Default. |
| Fastify 5 | TypeScript | You prefer Fastify | Same core and behavior as Express, with a Fastify adapter. |
| Gin | Go 1.26+ | Your team writes Go | A Go port of the same core. API only, new projects only, PostgreSQL or in-memory. |

All three pass the same 90 conformance cases.

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

Gin has no generated frontend. You can still use a Vue or React app with it: see [Frontend deployment](/configuration/frontend-deployment).

## A sensible first choice

```bash
npx selfauth init my-app --backend express --database memory --frontend vue
```

Express, memory, Vue: no database to install, a complete app with screens. Move to PostgreSQL when you are ready: see [Change the database](/build/database-changes).
