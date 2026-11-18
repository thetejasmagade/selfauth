import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * SelfAuth ownership manifest (plan §4.6, ADR 0004). Metadata about what
 * SelfAuth generated, not proof that nothing was modified.
 */
export const manifestFileSchema = z.strictObject({
  /** Path relative to the project root. */
  path: z.string(),
  /** Template the file was rendered from (`<stack>:<source>` or `rendered:<name>`). */
  template: z.string(),
  /** SHA-256 of the content as generated; differs once the developer edits the file. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const manifestSchema = z.strictObject({
  toolkit: z.literal("selfauth"),
  version: z.string(),
  /** Version of the templates used to generate the files (ADR 0004). */
  templateVersion: z.string().optional(),
  specVersion: z.string().regex(/^\d+\.\d+$/),
  database: z.strictObject({
    type: z.enum(["postgresql", "mysql", "sqlite", "mongodb", "memory"]),
    orm: z.enum(["prisma", "mongoose", "none"]),
  }),
  ownedResources: z.strictObject({
    tables: z.array(z.string()).default([]),
    types: z.array(z.string()).default([]),
    migrations: z.array(z.string()).default([]),
  }),
  /** Choices the project was generated with, so `upgrade` can re-plan it. */
  options: z
    .strictObject({
      /**
       * `project`: a project made by `init`. `add`: backend files added to an existing project.
       * `frontend`: the auth module added to an existing frontend (its own manifest; `database` is unused).
       * `server` and `client`: the two packages of a full-stack project made by `init` (structure 3);
       * each has its own manifest, and the client's `database` is unused.
       */
      layout: z.enum(["project", "add", "frontend", "server", "client"]).default("project"),
      /** Source folder the `add` and `frontend` layouts write under, relative to the manifest. */
      srcDir: z.string().default("src"),
      /**
       * Folder structure of the generated app code. 1: the flat src/ of SelfAuth 0.3 and earlier
       * (src/env.ts, src/mailer.ts, …); 2: grouped by responsibility (src/config/, src/email/, …);
       * 3: a full-stack project as two packages, server/ and client/, in one npm workspace.
       * Manifests written before this field existed are structure 1.
       */
      structure: z.number().int().min(1).default(1),
      /** The HTTP framework the backend was generated for. Manifests without it are Express. */
      backend: z.enum(["express", "fastify"]).default("express"),
      frontend: z.enum(["none", "vue", "react"]).default("none"),
      permissions: z.array(z.string()).default([]),
      appBaseUrl: z.string().optional(),
    })
    .optional(),
  /** Generated files and their original hashes, for upgrades and drift detection. */
  files: z.array(manifestFileSchema).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;

export const MANIFEST_FILE = "selfauth.manifest.json";

export async function readManifest(path: string): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
