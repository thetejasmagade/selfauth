import { say } from "./output.js";

export function list(): number {
  say("Supported integrations (selfauth init):\n");
  say("  Backend    express          Express 5 + TypeScript (reference implementation, 87/87 conformance cases)");
  say("  Database   postgresql       PostgreSQL via Prisma 7 (migrations reviewed with `selfauth db plan`)");
  say("             memory           In-memory store for trying SelfAuth out (not for production)");
  say("  Frontend   none             API only");
  say("\nComing next: Vue 3 and React frontends, `selfauth add` for existing projects, `diff`/`upgrade`.");
  say("MongoDB + Mongoose follows once the PostgreSQL path is stable.");
  return 0;
}
