<script setup lang="ts">
import { computed } from "vue";
import { useData, useRoute, withBase } from "vitepress";

// Section titles and the page each section opens on. Keep in step with the sidebar in config.mts.
const sections: Record<string, { title: string; link: string }> = {
  guide: { title: "Introduction", link: "/guide/what-is-selfauth" },
  "getting-started": { title: "Getting started", link: "/getting-started/quick-start" },
  structure: { title: "Project structure", link: "/structure/" },
  build: { title: "Build your app", link: "/build/add-api-route" },
  configuration: { title: "Configuration", link: "/configuration/config-file" },
  cli: { title: "CLI reference", link: "/cli/" },
  api: { title: "API reference", link: "/api/http" },
  advanced: { title: "Advanced", link: "/advanced/security" },
  resources: { title: "Resources", link: "/resources/changelog" },
};

const route = useRoute();
const { page, frontmatter } = useData();

const crumbs = computed(() => {
  const first = page.value.relativePath.split("/")[0] ?? "";
  const section = sections[first];
  if (!section || frontmatter.value["layout"] === "home") return [];
  return [{ title: "Home", link: "/" }, section];
});
</script>

<template>
  <nav v-if="crumbs.length && route.path" class="breadcrumbs" aria-label="Breadcrumb">
    <template v-for="(c, i) in crumbs" :key="c.link">
      <a :href="withBase(c.link)">{{ c.title }}</a>
      <span v-if="i < crumbs.length - 1" aria-hidden="true"> / </span>
    </template>
  </nav>
</template>
