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

/** Backend/full-stack frameworks SelfAuth does not generate for (yet). Reported, never guessed at. */
const OTHER_FRAMEWORKS = [
  "koa",
  "@hapi/hapi",
  "@nestjs/core",
  "hono",
  "next",
  "nuxt",
  "@sveltejs/kit",
  "@remix-run/node",
  "@adonisjs/core",
];

/** Database client packages (plan §6.1: detect the database and ORM). */
const DATABASE_CLIENTS = [
  "pg",
  "postgres",
  "mysql2",
  "mongodb",
  "mongoose",
  "better-sqlite3",
  "sqlite3",
  "typeorm",
  "sequelize",
  "drizzle-orm",
  "knex",
  "@mikro-orm/core",
];

/** Files that mark a non-JavaScript backend at the project root. */
const OTHER_LANGUAGES: Record<string, string> = {
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "go.mod": "go",
  Gemfile: "ruby",
  "composer.json": "php",
  "pom.xml": "java",
  "build.gradle": "java",
  "Cargo.toml": "rust",
};

export interface ProjectInfo {
  exists: boolean;
  /** No entries other than VCS metadata. */
  empty: boolean;
  hasPackageJson: boolean;
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | null;
  /** The supported backend framework in package.json (`express` wins when both are listed). */
  framework: "express" | "fastify" | null;
  typescript: boolean;
  prisma: boolean;
  existingAuth: string[];
  selfauth: boolean;
  /** Unsupported frameworks found in package.json. */
  otherFrameworks: string[];
  /** Non-JavaScript backends found at the root (python, go, ...). */
  otherLanguages: string[];
  /** Database client and ORM packages found in package.json. */
  databaseClients: string[];
  /** The datasource provider in prisma/schema.prisma, when there is one. */
  prismaProvider: string | null;
  /** `"type": "module"` in package.json. */
  esm: boolean;
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
    otherFrameworks: [],
    otherLanguages: [],
    databaseClients: [],
    prismaProvider: null,
    esm: false,
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
  info.otherLanguages = [
    ...new Set(
      Object.entries(OTHER_LANGUAGES).flatMap(([f, l]) => (entries.includes(f) ? [l] : [])),
    ),
  ];
  const schema = join(dir, "prisma", "schema.prisma");
  if (existsSync(schema)) {
    const datasource = /datasource\s+\w+\s*\{([^}]*)\}/.exec(await readFile(schema, "utf8"));
    info.prismaProvider = /provider\s*=\s*"([^"]+)"/.exec(datasource?.[1] ?? "")?.[1] ?? null;
  }
  if (entries.includes("package.json")) {
    info.hasPackageJson = true;
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      type?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if ("express" in deps) info.framework = "express";
    else if ("fastify" in deps) info.framework = "fastify";
    info.typescript = "typescript" in deps || entries.includes("tsconfig.json");
    info.prisma ||= "prisma" in deps || "@prisma/client" in deps;
    info.existingAuth = AUTH_PACKAGES.filter((p) => p in deps);
    info.otherFrameworks = OTHER_FRAMEWORKS.filter((p) => p in deps);
    info.databaseClients = DATABASE_CLIENTS.filter((p) => p in deps);
    info.esm = pkg.type === "module";
  }
  return info;
}
