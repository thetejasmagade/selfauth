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

// Social previews need an absolute image URL. Use the site's own address when it is known,
// otherwise the copy in the repository, so the image is never missing.
const ogImage = hostname
  ? `${hostname}${base}og.png`
  : `${REPO.replace("github.com", "raw.githubusercontent.com")}/main/website/public/og.png`;

const sidebar: DefaultTheme.Sidebar = [
  {
    text: "Start here",
    items: [
      { text: "What is SelfAuth?", link: "/start/what-is-selfauth" },
      { text: "How it works", link: "/start/how-it-works" },
      { text: "Pick your stack", link: "/start/pick-your-stack" },
    ],
  },
  {
    text: "Use with an AI agent",
    items: [
      { text: "Install the skill", link: "/ai/" },
      { text: "Prompts that work", link: "/ai/prompts" },
    ],
  },
  {
    text: "Express guide",
    collapsed: true,
    items: [
      { text: "Overview", link: "/express/" },
      { text: "1. Create your project", link: "/express/create-project" },
      { text: "2. Run it and sign in", link: "/express/run-and-sign-in" },
      { text: "3. Find your way around", link: "/express/project-tour" },
      { text: "4. Add endpoints", link: "/express/endpoints" },
      { text: "5. Add permissions", link: "/express/permissions" },
      { text: "6. Add a table", link: "/express/add-a-table" },
      { text: "7. Build the notes endpoints", link: "/express/notes-endpoints" },
      { text: "8. Change a table later", link: "/express/change-a-table" },
      { text: "9. Add a frontend page", link: "/express/frontend-page" },
      { text: "10. Test your endpoints", link: "/express/tests" },
      { text: "11. Get ready for production", link: "/express/production" },
    ],
  },
  {
    text: "Fastify guide",
    collapsed: true,
    items: [
      { text: "Overview", link: "/fastify/" },
      { text: "1. Create your project", link: "/fastify/create-project" },
      { text: "2. Run it and sign in", link: "/fastify/run-and-sign-in" },
      { text: "3. Find your way around", link: "/fastify/project-tour" },
      { text: "4. Add endpoints", link: "/fastify/endpoints" },
      { text: "5. Add permissions", link: "/fastify/permissions" },
      { text: "6. Add a table", link: "/fastify/add-a-table" },
      { text: "7. Build the notes endpoints", link: "/fastify/notes-endpoints" },
      { text: "8. Change a table later", link: "/fastify/change-a-table" },
      { text: "9. Add a frontend page", link: "/fastify/frontend-page" },
      { text: "10. Test your endpoints", link: "/fastify/tests" },
      { text: "11. Get ready for production", link: "/fastify/production" },
    ],
  },
  {
    text: "Gin (Go) guide",
    collapsed: true,
    items: [
      { text: "Overview", link: "/gin/" },
      { text: "1. Create your project", link: "/gin/create-project" },
      { text: "2. Run it and sign in", link: "/gin/run-and-sign-in" },
      { text: "3. Find your way around", link: "/gin/project-tour" },
      { text: "4. Add endpoints", link: "/gin/endpoints" },
      { text: "5. Add permissions", link: "/gin/permissions" },
      { text: "6. Add a table", link: "/gin/add-a-table" },
      { text: "7. Build the notes endpoints", link: "/gin/notes-endpoints" },
      { text: "8. Change a table later", link: "/gin/change-a-table" },
      { text: "9. Add a frontend page", link: "/gin/frontend-page" },
      { text: "10. Test your endpoints", link: "/gin/tests" },
      { text: "11. Get ready for production", link: "/gin/production" },
    ],
  },
  {
    text: "Flask (Python) guide",
    collapsed: true,
    items: [
      { text: "Overview", link: "/flask/" },
      { text: "1. Create your project", link: "/flask/create-project" },
      { text: "2. Run it and sign in", link: "/flask/run-and-sign-in" },
      { text: "3. Find your way around", link: "/flask/project-tour" },
      { text: "4. Add endpoints", link: "/flask/endpoints" },
      { text: "5. Add permissions", link: "/flask/permissions" },
      { text: "6. Add a table and the notes endpoints", link: "/flask/notes" },
      { text: "7. Change a table later", link: "/flask/change-a-table" },
      { text: "8. Test your endpoints", link: "/flask/tests" },
      { text: "9. Get ready for production", link: "/flask/production" },
    ],
  },
  {
    text: "Email providers",
    collapsed: true,
    items: [
      { text: "Send real email", link: "/email/" },
      { text: "Resend", link: "/email/resend" },
      { text: "Postmark", link: "/email/postmark" },
      { text: "SendGrid", link: "/email/sendgrid" },
      { text: "Mailgun", link: "/email/mailgun" },
      { text: "Brevo", link: "/email/brevo" },
      { text: "SMTP and Amazon SES", link: "/email/smtp" },
      { text: "A provider that isn't listed", link: "/email/other-providers" },
      { text: "Test your mailer", link: "/email/testing" },
    ],
  },
  {
    text: "Reference",
    collapsed: true,
    items: [
      { text: "CLI overview", link: "/reference/cli/" },
      { text: "init", link: "/reference/cli/init" },
      { text: "add and add-frontend", link: "/reference/cli/add" },
      { text: "detect, list, doctor, validate", link: "/reference/cli/inspect" },
      { text: "diff and upgrade", link: "/reference/cli/upgrade" },
      { text: "db", link: "/reference/cli/db" },
      { text: "skill", link: "/reference/cli/skill" },
      { text: "Configuration file", link: "/reference/config-file" },
      { text: "Environment variables", link: "/reference/environment" },
      { text: "Frontend deployment", link: "/reference/frontend-deployment" },
      { text: "HTTP API", link: "/reference/http" },
      { text: "Error codes", link: "/reference/errors" },
      { text: "Server API (TypeScript)", link: "/reference/server-typescript" },
      { text: "Server API (Go)", link: "/reference/server-go" },
      { text: "Server API (Python)", link: "/reference/server-python" },
      { text: "Client API (Vue and React)", link: "/reference/client" },
    ],
  },
  {
    text: "Help",
    items: [
      { text: "Troubleshooting", link: "/help/troubleshooting" },
      { text: "FAQ", link: "/help/faq" },
    ],
  },
  {
    text: "Project",
    collapsed: true,
    items: [
      { text: "Changelog", link: "/resources/changelog" },
      { text: "Contributing", link: "/resources/contributing" },
      { text: "License", link: "/resources/license" },
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
      ["meta", { property: "og:image", content: ogImage }],
      ["meta", { property: "og:image:width", content: "1200" }],
      ["meta", { property: "og:image:height", content: "630" }],
      [
        "meta",
        { property: "og:image:alt", content: "SelfAuth: authentication that lives in your repo" },
      ],
      ["meta", { name: "twitter:card", content: "summary_large_image" }],
      ["meta", { name: "twitter:image", content: ogImage }],
    ],
    sitemap: hostname ? { hostname } : undefined,
    markdown: {
      lineNumbers: false,
      // "prompt" blocks hold text to paste into an AI agent: plain text, with a copy button.
      languages: [{ name: "prompt", scopeName: "source.prompt", patterns: [] }],
    },
    // The mermaid library is large by design; it loads only on pages with diagrams.
    vite: { build: { chunkSizeWarningLimit: 3000 } },
    // SVG text labels, so the page's paragraph spacing cannot clip text inside the boxes.
    mermaid: {
      theme: "neutral",
      flowchart: { htmlLabels: false },
      sequence: { useMaxWidth: true },
    },
    themeConfig: {
      logo: "/logo.svg",
      siteTitle: "SelfAuth",
      nav: [
        { text: "Start here", link: "/start/what-is-selfauth", activeMatch: "/start/" },
        { text: "AI agent", link: "/ai/", activeMatch: "/ai/" },
        { text: "Email", link: "/email/", activeMatch: "/email/" },
        {
          text: "Guides",
          items: [
            { text: "Express", link: "/express/" },
            { text: "Fastify", link: "/fastify/" },
            { text: "Gin (Go)", link: "/gin/" },
            { text: "Flask (Python)", link: "/flask/" },
          ],
        },
        {
          text: "Reference",
          items: [
            { text: "CLI", link: "/reference/cli/" },
            { text: "Configuration file", link: "/reference/config-file" },
            { text: "HTTP API", link: "/reference/http" },
            { text: "Error codes", link: "/reference/errors" },
          ],
        },
        { text: "Help", link: "/help/troubleshooting", activeMatch: "/help/" },
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
