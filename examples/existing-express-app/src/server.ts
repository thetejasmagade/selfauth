import { createApp } from "./app.ts";

const app = await createApp();
const port = Number(process.env["PORT"] ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console -- startup message
  console.log(`listening on :${port}`);
});
