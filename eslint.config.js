import globals from "globals";

// Catches what the build does not: a name used where it is not defined only fails once the page renders.
export default [
  { ignores: ["dist/", ".vite/", "node_modules/"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.node, __APP_VERSION__: "readonly" } },
    rules: { "no-undef": "error", "no-unused-vars": "warn" },
  },
];
