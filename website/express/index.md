---
title: Express guide
description: Build a small notes app with Express and SelfAuth from start to finish. Create the project, sign in, add endpoints, permissions, an admin view, a database table with migrations, a frontend page, tests and a production setup.
keywords: [express, selfauth tutorial, notes app, express authentication, express permissions, prisma migration]
---

# Express guide

In this guide you'll build a small notes app on Express. People sign up, save notes and read their own. Admins can read everyone's notes. It's small enough to finish in an afternoon and touches every part you'll use in a real project.

You'll learn how to:

1. [Create your project](./create-project)
2. [Run it and sign in for the first time](./run-and-sign-in)
3. [Find your way around the files](./project-tour)
4. [Add endpoints: public and signed-in](./endpoints)
5. [Add permissions, and an admin-only one](./permissions)
6. [Add a table with a migration](./add-a-table)
7. [Build the notes endpoints](./notes-endpoints)
8. [Change a table later](./change-a-table)
9. [Add a frontend page](./frontend-page)
10. [Test your endpoints](./tests)
11. [Get ready for production](./production)

Do the chapters in order. Each one builds on the last and ends with a way to check it worked.

## Before you start

You need Node.js 22.18 or newer (`node --version` tells you) and a terminal. The guide uses SQLite, which needs nothing else installed. Where PostgreSQL, MySQL or MongoDB need something different, you'll see a tab for them.

On Windows, the commands work in PowerShell. Where PowerShell needs a different spelling, the guide shows it.

Don't know what a session or a permission is yet? [How it works](/start/how-it-works) explains the terms in five minutes.
