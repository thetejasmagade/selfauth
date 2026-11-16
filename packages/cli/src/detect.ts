import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Packages that indicate an existing authentication setup (plan §6.1). */
const AUTH_PACKAGES = [
  "passport",
  "express-session",
  "cookie-session",
  "next-auth",
  "@auth/core",
  "@auth/express",
  "lucia",
  "better-auth",
  "@clerk/express",
  "@supabase/auth-js",
  "firebase-admin",
  "jsonwebtoken",
];

export interface ProjectInfo {
  exists: boolean;
  /** No entries other than VCS metadata. */
  empty: boolean;
  hasPackageJson: boolean;
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | null;
  framework: "express" | null;
  typescript: boolean;
  prisma: boolean;
  existingAuth: string[];
  selfauth: boolean;
}

export async function detectProject(dir: string): Promise<ProjectInfo> {
  const info: ProjectInfo = {
    exists: existsSync(dir),
    empty: true,
    hasPackageJson: false,
    packageManager: null,
    framework: null,
    typescript: false,
    prisma: false,
    existingAuth: [],
    selfauth: false,
  };
  if (!info.exists) return info;
  const entries = (await readdir(dir)).filter((e) => ![".git", ".DS_Store"].includes(e));
  info.empty = entries.length === 0;
  info.selfauth = entries.includes("selfauth.manifest.json");
  info.packageManager = entries.includes("pnpm-lock.yaml")
    ? "pnpm"
    : entries.includes("yarn.lock")
      ? "yarn"
      : entries.includes("bun.lockb") || entries.includes("bun.lock")
        ? "bun"
        : entries.includes("package-lock.json")
          ? "npm"
          : null;
  info.prisma = entries.includes("prisma") || entries.includes("prisma.config.ts");
  if (entries.includes("package.json")) {
    info.hasPackageJson = true;
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if ("express" in deps) info.framework = "express";
    info.typescript = "typescript" in deps || entries.includes("tsconfig.json");
    info.prisma ||= "prisma" in deps || "@prisma/client" in deps;
    info.existingAuth = AUTH_PACKAGES.filter((p) => p in deps);
  }
  return info;
}
