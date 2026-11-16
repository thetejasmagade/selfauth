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
    type: z.enum(["postgresql", "mongodb", "memory"]),
    orm: z.enum(["prisma", "mongoose", "none"]),
  }),
  ownedResources: z.strictObject({
    tables: z.array(z.string()).default([]),
    types: z.array(z.string()).default([]),
    migrations: z.array(z.string()).default([]),
  }),
  /** Generated files and their original hashes, for upgrades and drift detection. */
  files: z.array(manifestFileSchema).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;

export const MANIFEST_FILE = "selfauth.manifest.json";

export async function readManifest(path: string): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
