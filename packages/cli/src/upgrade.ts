import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MANIFEST_FILE, manifestSchema, type Manifest } from "@selfauth/migration";
import { createTwoFilesPatch } from "diff";
import { frontendAddFiles, sha256, templateFiles, type PlannedFile } from "./plan.js";
import { hasFlatLayout } from "./project.js";
import type { InitAnswers } from "./render.js";
import { templateSource, type TemplateSource } from "./templates.js";
import { CLI_VERSION } from "./version.js";

/**
 * What `upgrade` would do with each template file (ADR 0004):
 * - unchanged: nothing to do;
 * - update: you never edited the file and the template changed → safe to replace;
 * - add: a new template file;
 * - kept: you edited the file but the template did not change → yours stays;
 * - conflict: you edited it and the template changed (or SelfAuth does not own an existing
 *   file at that path) → a `.selfauth-new` proposal is written next to it, never over it;
 * - deleted: you deleted a generated file → it stays deleted;
 * - removed: the template no longer ships a file you have → reported, left alone.
 */
export type UpgradeStatus =
  "unchanged" | "update" | "add" | "kept" | "conflict" | "deleted" | "removed";

export interface UpgradeItem {
  path: string;
  status: UpgradeStatus;
  template: string;
  reason?: string;
  /** Unified diff from the current file to the new template (update / conflict). */
  diff?: string;
  next?: string;
}

export interface UpgradePlan {
  manifest: Manifest;
  items: UpgradeItem[];
  fromVersion: string;
  toVersion: string;
}

export const PROPOSAL_SUFFIX = ".selfauth-new";

function answersFrom(
  manifest: Manifest,
): Pick<InitAnswers, "database" | "frontend" | "backend" | "module"> {
  const database = manifest.database.type;
  const module = manifest.options?.module;
  return {
    database,
    frontend: manifest.options?.frontend ?? "none",
    backend: manifest.options?.backend ?? "express",
    ...(module === undefined ? {} : { module }),
  };
}

export async function planUpgrade(
  dir: string,
  source: TemplateSource = templateSource(),
): Promise<UpgradePlan> {
  const path = join(dir, MANIFEST_FILE);
  if (!existsSync(path))
    throw new Error("not a SelfAuth project (selfauth.manifest.json not found)");
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (hasFlatLayout(manifest)) {
    throw new Error(
      "this project uses the flat src/ layout of SelfAuth 0.3 and earlier (src/env.ts, src/mailer.ts, …). " +
        "Newer templates group those files (src/config/, src/email/, src/db/, src/http/, src/routes/), " +
        "so `upgrade` cannot update it safely. `doctor` and `validate` still work. " +
        "Run `selfauth upgrade --reorganize` to move it to the new layout (it moves the files and fixes the imports).",
    );
  }
  const layout = manifest.options?.layout ?? "project";
  const srcDir = manifest.options?.srcDir ?? "src";
  const frontend = manifest.options?.frontend ?? "none";
  // A full-stack project's two packages each have a manifest: the server's lists the backend
  // files, the client's the frontend files (paths relative to its own package).
  const next =
    layout === "frontend"
      ? await frontendAddFiles(frontend === "react" ? "react" : "vue", source, srcDir)
      : await templateFiles(
          answersFrom(manifest),
          source,
          layout === "add" ? "add" : "project",
          srcDir,
          layout === "server" ? "server" : layout === "client" ? "client" : "all",
        );
  const recorded = new Map((manifest.files ?? []).map((f) => [f.path, f]));
  const items: UpgradeItem[] = [];

  for (const file of next) {
    const entry = recorded.get(file.path);
    const target = join(dir, file.path);
    const exists = existsSync(target);
    const current = exists ? await readFile(target, "utf8") : undefined;
    const nextHash = sha256(file.content);
    const diff = () =>
      createTwoFilesPatch(
        `a/${file.path}`,
        `b/${file.path}`,
        current ?? "",
        file.content,
        "yours",
        "template",
      );
    const item = (status: UpgradeStatus, extra: Partial<UpgradeItem> = {}): UpgradeItem => ({
      path: file.path,
      status,
      template: file.template,
      next: file.content,
      ...extra,
    });

    if (!entry) {
      if (current === undefined) items.push(item("add"));
      else if (sha256(current) === nextHash) items.push(item("unchanged"));
      else
        items.push(
          item("conflict", {
            reason: "a file SelfAuth did not create exists at this path",
            diff: diff(),
          }),
        );
      continue;
    }
    if (current === undefined) {
      items.push(item("deleted", { reason: "you deleted this generated file" }));
      continue;
    }
    const currentHash = sha256(current);
    if (currentHash === nextHash) items.push(item("unchanged"));
    else if (currentHash === entry.sha256) items.push(item("update", { diff: diff() }));
    else if (nextHash === entry.sha256)
      items.push(item("kept", { reason: "you changed it; the template did not" }));
    else
      items.push(
        item("conflict", { reason: "you changed it and the template changed too", diff: diff() }),
      );
  }

  const nextPaths = new Set(next.map((f) => f.path));
  for (const entry of manifest.files ?? []) {
    if (entry.template.startsWith("rendered:") || nextPaths.has(entry.path)) continue;
    items.push({
      path: entry.path,
      status: "removed",
      template: entry.template,
      reason: "no longer part of the templates; left in place",
    });
  }
  return {
    manifest,
    items,
    fromVersion: manifest.templateVersion ?? "unknown",
    toVersion: CLI_VERSION,
  };
}

export interface UpgradeResult {
  written: string[];
  proposals: string[];
  skipped: string[];
}

/** Applies safe changes, writes proposals for conflicts, and records the new state in the manifest. */
export async function applyUpgrade(dir: string, plan: UpgradePlan): Promise<UpgradeResult> {
  const result: UpgradeResult = { written: [], proposals: [], skipped: [] };
  const hashes = new Map((plan.manifest.files ?? []).map((f) => [f.path, f]));

  for (const item of plan.items) {
    const target = join(dir, item.path);
    if (item.status === "update") {
      // Re-check right before writing: never overwrite a file edited since the plan was made.
      const recorded = hashes.get(item.path)!;
      if (sha256(await readFile(target, "utf8")) !== recorded.sha256) {
        result.skipped.push(item.path);
        continue;
      }
      await writeFile(target, item.next!);
      hashes.set(item.path, { ...recorded, template: item.template, sha256: sha256(item.next!) });
      result.written.push(item.path);
    } else if (item.status === "add") {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, item.next!, { flag: "wx" });
      hashes.set(item.path, {
        path: item.path,
        template: item.template,
        sha256: sha256(item.next!),
      });
      result.written.push(item.path);
    } else if (item.status === "unchanged") {
      // Your file equals the new template (possibly because you applied the same change):
      // the new template content becomes the recorded original.
      hashes.set(item.path, {
        path: item.path,
        template: item.template,
        sha256: sha256(item.next!),
      });
    } else if (item.status === "conflict") {
      const proposal = `${target}${PROPOSAL_SUFFIX}`;
      if (existsSync(proposal)) {
        result.skipped.push(`${item.path}${PROPOSAL_SUFFIX}`);
        continue;
      }
      await writeFile(proposal, item.next!, { flag: "wx" });
      result.proposals.push(`${item.path}${PROPOSAL_SUFFIX}`);
      // The manifest keeps the original hash, so the file stays "yours" until you merge.
    }
  }

  const manifest: Manifest = {
    ...plan.manifest,
    version: CLI_VERSION,
    templateVersion: CLI_VERSION,
    files: [...hashes.values()],
  };
  await writeFile(
    join(dir, MANIFEST_FILE),
    `${JSON.stringify(manifestSchema.parse(manifest), null, 2)}\n`,
  );
  return result;
}

export type { PlannedFile };
