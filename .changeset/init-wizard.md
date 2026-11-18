---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

`selfauth init` is now an interactive wizard when it runs in a terminal without `--yes`.

- Arrow-key menus (or press a number) for backend, database and frontend, each with a one-line
  hint, instead of typing a word and finding out about a typo later.
- It also asks for the project folder, your application permissions, where your frontend runs
  (API-only projects) and whether to run `npm install`.
- A bad answer is explained and asked again at once; flag values are checked before anything is
  asked; Ctrl-C cancels with exit code 130 and writes nothing.
- Flags still answer their question in advance. With `--yes`, or without a terminal, nothing is
  asked, exactly as before.
