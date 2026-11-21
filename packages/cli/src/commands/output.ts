/* eslint-disable no-console */
import { cyan, green, red, yellow } from "../ui.js";

export const ok = (msg: string) => console.log(`  ${green("✓")} ${msg}`);
export const warn = (msg: string) => console.log(`  ${yellow("⚠")} ${msg}`);
export const fail = (msg: string) => console.log(`  ${red("✗")} ${msg}`);
export const info = (msg: string) => console.log(`  ${cyan("•")} ${msg}`);
export const say = (msg = "") => console.log(msg);
