---
title: Pick your stack
description: Choose a backend, a database and a frontend for your SelfAuth project, see what you need installed, and find the guide to follow.
keywords: [choose stack, express, fastify, next.js, gin, flask, python, postgresql, mysql, sqlite, mongodb, vue, react, prerequisites]
---

# Pick your stack

You make three choices when you create a project. You can't easily change them later, so here's what each one means.

## Backend

| Choose | If |
| --- | --- |
| **Express** | You write JavaScript or TypeScript and want the most common choice. Start here if you're unsure. |
| **Fastify** | You write TypeScript and already like Fastify. |
| **Next.js** | You build with Next.js and want the API in the same app: sign-in pages and API routes together. |
| **Gin** | You write Go. |
| **Flask** | You write Python. |

## Database

| Choose | If |
| --- | --- |
| **SQLite** | You're learning or trying things out. It's a single file and needs nothing installed. The guides use it. |
| **PostgreSQL** | You're building something real. It's the best-tested choice. |
| **MySQL** | Your team or host already uses MySQL or MariaDB. |
| **MongoDB** | You already use MongoDB. |
| **Memory** | You only want to look around. Everything is lost when the server stops, and you can't add your own tables. |

SQLite runs as a single process, so before you run several copies of your server, move to PostgreSQL, MySQL or MongoDB.

## Frontend

| Choose | If |
| --- | --- |
| **None** | You only need an API, or you'll build the frontend separately. [Here's how to connect your own frontend](./use-your-own-frontend). |
| **React** or **Vue** | You want sign-in, sign-up, password reset and account pages ready to use. [Here's how to open them and try them](./try-the-frontend). |
| **Next.js** | You want those pages in a Next.js app. With the Next.js backend the pages and the API are one app. With Express, Fastify, Gin or Flask it's a Next.js app in front of that API. |

With a Vue or React frontend, your project has two folders: `server/` for the API and `client/` for the pages. The guides point out where that changes a path. The one exception is the Next.js backend with the Next.js frontend, which is a single app with the pages and the API side by side.

## What to install first

| For | You need |
| --- | --- |
| Express, Fastify or Next.js | [Node.js](https://nodejs.org) 22.18 or newer. Check with `node --version`. |
| Gin | [Go](https://go.dev/dl/) 1.26 or newer, and Node.js 22.18 or newer to run the `selfauth` command |
| Flask | [Python](https://www.python.org/downloads/) 3.11 or newer, and Node.js 22.18 or newer to run the `selfauth` command |
| PostgreSQL, MySQL or MongoDB | A running database server and an empty database. SQLite needs nothing. |

## Your guide

Each guide builds the same small app from start to finish: a notes app where people save notes and read their own, and admins can read everyone's. Pick yours:

- [Express guide](/express/)
- [Fastify guide](/fastify/)
- [Next.js guide](/next/) (pages and API in one app), and [Next.js with another backend](/next/with-another-backend)
- [Gin (Go) guide](/gin/)
- [Flask (Python) guide](/flask/)
