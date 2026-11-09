import { execSync } from "node:child_process";
import { defineConfig } from "vite";

const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();
const version = [new Date().toISOString().slice(0, 10), commit].filter(Boolean).join(" · ");

// Relative paths so the build runs from a GitHub Pages project site (/home-meters/).
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
});
