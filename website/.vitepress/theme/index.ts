import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import type { Theme } from "vitepress";
import Breadcrumbs from "./Breadcrumbs.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { "doc-before": () => h(Breadcrumbs) }),
} satisfies Theme;
