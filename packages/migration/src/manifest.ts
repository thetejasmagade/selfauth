import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * SelfAuth ownership manifest (plan §4.6, ADR 0004). Metadata about what
 * SelfAuth generated, not proof that nothing was modified.
 */
export const manifestSchema = z.strictObject({
  toolkit: z.literal("selfauth"),
  version: z.string(),
  specVersion: z.string().regex(/^\d+\.\d+$/),
  database: z.strictObject({
    type: z.enum(["postgresql", "mongodb"]),
    orm: z.enum(["prisma", "mongoose"]),
  }),
  ownedResources: z.strictObject({
    tables: z.array(z.string()).default([]),
    types: z.array(z.string()).default([]),
    migrations: z.array(z.string()).default([]),
  }),
});

export type Manifest = z.infer<typeof manifestSchema>;

export const MANIFEST_FILE = "selfauth.manifest.json";

export async function readManifest(path: string): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
