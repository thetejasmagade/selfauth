import { describe, expect, it } from "vitest";
import { planInit } from "../src/index.js";

/** Gin with a Vue or React frontend: the Go module in server/, the frontend in client/. */
const base = {
  name: "shop",
  backend: "gin" as const,
  module: "github.com/acme/shop",
  permissions: ["orders.view"],
};

describe.each(["vue", "react"] as const)("init --backend gin --frontend %s", (frontend) => {
  for (const database of ["memory", "postgresql"] as const) {
    it(`plans server/, client/ and a workspace root (${database})`, async () => {
      const appBaseUrl = frontend === "vue" ? "http://localhost:5173" : "http://localhost:5174";
      const files = await planInit({ ...base, database, frontend, appBaseUrl });
      const paths = files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);

      // The Go module is under server/, with the project's module path in go.mod and imports.
      expect(paths).toContain("server/go.mod");
      expect(paths).toContain("server/selfauth.config.json");
      expect(paths).toContain("server/.env.example");
      expect(files.find((f) => f.path === "server/go.mod")!.content).toContain(
        "module github.com/acme/shop\n",
      );
      const imports = files
        .filter((f) => f.path.startsWith("server/") && f.path.endsWith(".go"))
        .map((f) => f.content)
        .join("\n");
      expect(imports).toContain('"github.com/acme/shop/internal/auth"');
      expect(imports).not.toContain("example.com/app");
      expect(paths.some((p) => p.startsWith("server/db/migrations/"))).toBe(
        database === "postgresql",
      );

      // The frontend is under client/, without the notes demo the reference app carries.
      expect(paths).toContain("client/package.json");
      expect(paths).toContain("client/src/auth/client.ts");
      expect(paths.some((p) => /NotesPage/.test(p))).toBe(false);
      const app = files.find((f) => /^client\/src\/App\.(vue|tsx)$/.test(f.path))!;
      expect(app.content).not.toContain("NotesPage");

      // The root only runs the two: npm for the client, Go for the server.
      const root = JSON.parse(files.find((f) => f.path === "package.json")!.content);
      expect(root.workspaces).toEqual(["client"]);
      expect(root.scripts.dev).toContain("dev:server");
      expect(root.scripts["dev:server"]).toBe("node scripts/dev-server.mjs");
      expect("db:migrate" in root.scripts).toBe(database === "postgresql");
      const dev = files.find((f) => f.path === "scripts/dev-server.mjs")!.content;
      expect(dev).toContain(`"${appBaseUrl}"`);
      expect(dev).toContain("server/.env");

      // Each package has its own manifest, so doctor, validate, diff and upgrade work in both.
      const server = JSON.parse(
        files.find((f) => f.path === "server/selfauth.manifest.json")!.content,
      );
      const client = JSON.parse(
        files.find((f) => f.path === "client/selfauth.manifest.json")!.content,
      );
      expect(server.options).toMatchObject({
        layout: "server",
        backend: "gin",
        module: "github.com/acme/shop",
        frontend,
      });
      expect(server.database.orm).toBe("none");
      expect(client.options).toMatchObject({ layout: "client", frontend });
      // Manifest paths are relative to their own package.
      expect(server.files.every((f: { path: string }) => !f.path.startsWith("server/"))).toBe(true);
      expect(client.files.every((f: { path: string }) => !f.path.startsWith("client/"))).toBe(true);
    });
  }

  it("still refuses a database Gin has no store for", async () => {
    await expect(
      planInit({ ...base, database: "mongodb", frontend, appBaseUrl: "http://localhost:5173" }),
    ).rejects.toThrow(/Gin backend supports/);
  });
});
