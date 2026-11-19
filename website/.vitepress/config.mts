import { defineConfig, type DefaultTheme } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

const REPO = "https://github.com/thetejasmagade/selfauth";
// Set DOCS_BASE (for example "/selfauth/") when the site is not served from the domain root,
// and DOCS_HOSTNAME (for example "https://docs.example.com") to emit canonical URLs and a sitemap.
const base = process.env["DOCS_BASE"] ?? "/";
// On Vercel the production domain is provided; elsewhere set DOCS_HOSTNAME yourself.
const vercelHost = process.env["VERCEL_PROJECT_PRODUCTION_URL"];
const hostname = (
  process.env["DOCS_HOSTNAME"] ?? (vercelHost ? `https://${vercelHost}` : undefined)
)?.replace(/\/$/, "");

const sidebar: DefaultTheme.Sidebar = [
  {
    text: "Introduction",
    items: [
      { text: "What is SelfAuth?", link: "/guide/what-is-selfauth" },
      { text: "How it works", link: "/guide/how-it-works" },
      { text: "Concepts and terms", link: "/guide/concepts" },
    ],
  },
  {
    text: "Use the AI skill",
    items: [
      { text: "Install and how it works", link: "/ai-skill/" },
      { text: "Prompts that work", link: "/ai-skill/prompts" },
    ],
  },
  {
    text: "Getting started",
    items: [
      { text: "Prerequisites", link: "/getting-started/prerequisites" },
      { text: "Choose your stack", link: "/getting-started/choose-your-stack" },
      { text: "Quick start", link: "/getting-started/quick-start" },
      { text: "Try the authentication flow", link: "/getting-started/first-flow" },
      { text: "Next steps", link: "/getting-started/next-steps" },
    ],
  },
  {
    text: "Project structure",
    items: [
      { text: "Overview and ownership map", link: "/structure/" },
      { text: "Express API", link: "/structure/express" },
      { text: "Fastify API", link: "/structure/fastify" },
      { text: "Gin (Go) API", link: "/structure/gin" },
      { text: "Full stack: Vue or React", link: "/structure/full-stack" },
      { text: "What each database changes", link: "/structure/databases" },
    ],
  },
  {
    text: "Build your app",
    items: [
      { text: "Add an API route", link: "/build/add-api-route" },
      { text: "Protect routes", link: "/build/protect-routes" },
      { text: "Permissions and roles", link: "/build/permissions-roles" },
      { text: "Resources and ownership", link: "/build/resource-ownership" },
      { text: "Add a frontend page", link: "/build/frontend-pages" },
      { text: "Change the database", link: "/build/database-changes" },
      { text: "Send real email", link: "/build/email" },
      { text: "Write tests", link: "/build/tests" },
    ],
  },
  {
    text: "Configuration",
    items: [
      { text: "The configuration file", link: "/configuration/config-file" },
      { text: "Environment variables", link: "/configuration/environment" },
      { text: "Frontend deployment", link: "/configuration/frontend-deployment" },
    ],
  },
  {
    text: "CLI reference",
    items: [
      { text: "Overview", link: "/cli/" },
      { text: "init", link: "/cli/init" },
      { text: "add and add-frontend", link: "/cli/add" },
      { text: "detect, list, doctor, validate", link: "/cli/inspect" },
      { text: "diff and upgrade", link: "/cli/upgrade" },
      { text: "db", link: "/cli/db" },
      { text: "skill", link: "/cli/skill" },
    ],
  },
  {
    text: "API reference",
    items: [
      { text: "HTTP API", link: "/api/http" },
      { text: "Error codes", link: "/api/errors" },
      { text: "Server API (TypeScript)", link: "/api/server" },
      { text: "Server API (Go and Gin)", link: "/api/go" },
      { text: "Client API (Vue and React)", link: "/api/client" },
    ],
  },
  {
    text: "Advanced",
    items: [
      { text: "Security model", link: "/advanced/security" },
      { text: "Going to production", link: "/advanced/production" },
      { text: "Existing projects", link: "/advanced/existing-projects" },
      { text: "Custom database store", link: "/advanced/custom-store" },
      { text: "Data retention", link: "/advanced/data-retention" },
      { text: "Conformance and support", link: "/advanced/conformance" },
      { text: "Moving from another auth system", link: "/advanced/migrating" },
    ],
  },
  {
    text: "Help",
    items: [
      { text: "Troubleshooting", link: "/troubleshooting" },
      { text: "FAQ", link: "/faq" },
    ],
  },
  {
    text: "Resources",
    items: [
      { text: "Changelog", link: "/resources/changelog" },
      { text: "Contributing", link: "/resources/contributing" },
      { text: "License", link: "/resources/license" },
      { text: "Documentation coverage", link: "/resources/coverage" },
    ],
  },
];

export default withMermaid(
  defineConfig({
    lang: "en-US",
    title: "SelfAuth",
    titleTemplate: ":title | SelfAuth docs",
    description:
      "SelfAuth generates authentication and authorization code inside your own project. Learn to install it, configure it, add routes and pages, and run it in production.",
    base,
    cleanUrls: true,
    srcExclude: ["README.md"],
    head: [
      ["link", { rel: "icon", type: "image/svg+xml", href: `${base}logo.svg` }],
      ["meta", { name: "theme-color", content: "#3451b2" }],
      ["meta", { property: "og:site_name", content: "SelfAuth docs" }],
      ["meta", { property: "og:type", content: "website" }],
      ["meta", { name: "twitter:card", content: "summary" }],
    ],
    sitemap: hostname ? { hostname } : undefined,
    markdown: { lineNumbers: false },
    // The mermaid library is large by design; it loads only on pages with diagrams.
    vite: { build: { chunkSizeWarningLimit: 3000 } },
    mermaid: { theme: "neutral" },
    themeConfig: {
      logo: "/logo.svg",
      siteTitle: "SelfAuth",
      nav: [
        { text: "Guide", link: "/guide/what-is-selfauth", activeMatch: "/guide/" },
        { text: "AI skill", link: "/ai-skill/", activeMatch: "/ai-skill/" },
        {
          text: "Getting started",
          link: "/getting-started/quick-start",
          activeMatch: "/getting-started/",
        },
        { text: "Project structure", link: "/structure/", activeMatch: "/structure/" },
        { text: "Build your app", link: "/build/add-api-route", activeMatch: "/build/" },
        {
          text: "Reference",
          items: [
            { text: "CLI", link: "/cli/" },
            { text: "HTTP API", link: "/api/http" },
            { text: "Configuration file", link: "/configuration/config-file" },
            { text: "Error codes", link: "/api/errors" },
          ],
        },
        {
          text: "Help",
          items: [
            { text: "Troubleshooting", link: "/troubleshooting" },
            { text: "FAQ", link: "/faq" },
            { text: "Advanced guides", link: "/advanced/security" },
          ],
        },
        { text: "Changelog", link: "/resources/changelog" },
      ],
      sidebar,
      outline: { level: [2, 3], label: "On this page" },
      socialLinks: [{ icon: "github", link: REPO }],
      search: { provider: "local", options: { detailedView: true } },
      editLink: {
        pattern: `${REPO}/edit/main/website/:path`,
        text: "Suggest a change to this page",
      },
      docFooter: { prev: "Previous page", next: "Next page" },
      footer: {
        message: "SelfAuth is MIT licensed. Generated code is also offered under 0BSD.",
        copyright: "Authentication. Fully yours.",
      },
    },
    transformPageData(pageData) {
      // One canonical URL per page when a public hostname is known.
      if (hostname) {
        const path = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
        pageData.frontmatter.head ??= [];
        pageData.frontmatter.head.push([
          "link",
          { rel: "canonical", href: `${hostname}${base}${path}` },
        ]);
      }
    },
    transformHead({ pageData }) {
      const fm = pageData.frontmatter as Record<string, unknown>;
      const title = String(fm["title"] ?? pageData.title ?? "SelfAuth");
      const description = String(fm["description"] ?? pageData.description ?? "");
      const tags: [string, Record<string, string>][] = [
        ["meta", { property: "og:title", content: `${title} | SelfAuth docs` }],
        ["meta", { property: "og:description", content: description }],
      ];
      if (Array.isArray(fm["keywords"]) && fm["keywords"].length > 0) {
        tags.push(["meta", { name: "keywords", content: (fm["keywords"] as string[]).join(", ") }]);
      }
      return tags;
    },
  }),
);
