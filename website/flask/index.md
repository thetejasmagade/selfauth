---
title: Flask (Python) guide
description: Build a small notes app with Flask, Python and SelfAuth from start to finish. Create the project, sign in, add endpoints, permissions, an admin view, a database table with SQL migrations, Python tests and a production setup.
keywords: [flask, python, selfauth tutorial, notes app, flask authentication, flask permissions, python migrations]
---

# Flask (Python) guide

In this guide you'll build a small notes app on Flask, in Python. People sign up, save notes and read their own. Admins can read everyone's notes. It's small enough to finish in an afternoon and touches every part you'll use in a real project.

You'll learn how to:

1. [Create your project](./create-project)
2. [Run it and sign in for the first time](./run-and-sign-in)
3. [Find your way around the files](./project-tour)
4. [Add endpoints: public and signed-in](./endpoints)
5. [Add permissions, and an admin-only one](./permissions)
6. [Add a table and build the notes endpoints](./notes)
7. [Change a table later](./change-a-table)
8. [Test your endpoints](./tests)
9. [Get ready for production](./production)

Do the chapters in order. Each one builds on the last and ends with a way to check it worked.

## Before you start

You need:

- [Python](https://www.python.org/downloads/) 3.11 or newer (`python3 --version` tells you),
- Node.js 22.18 or newer, only to run the `selfauth` command (`node --version`),
- a terminal.

The guide uses SQLite, which needs nothing else installed. Where PostgreSQL, MySQL or MongoDB need something different, you'll see a tab for them.

Want a Vue or React frontend too? Create the project with `--frontend vue` or `--frontend react`. The Python code then lives in `server/`, and the frontend chapter of the [Express guide](/express/frontend-page) applies unchanged, because the pages talk to the same `/auth` and `/api` routes whatever the backend is.

Don't know what a session or a permission is yet? [How it works](/start/how-it-works) explains the terms in five minutes.
