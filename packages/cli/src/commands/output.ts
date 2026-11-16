/* eslint-disable no-console */
export const ok = (msg: string) => console.log(`  ✓ ${msg}`);
export const warn = (msg: string) => console.log(`  ⚠ ${msg}`);
export const fail = (msg: string) => console.log(`  ✗ ${msg}`);
export const info = (msg: string) => console.log(`  • ${msg}`);
export const say = (msg = "") => console.log(msg);
