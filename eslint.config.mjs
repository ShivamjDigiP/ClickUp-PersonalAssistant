import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // External API JSON is untyped for now; tighten with zod schemas in MVP.
  {
    files: ["lib/**/*.ts", "app/api/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Tests build small fake objects on purpose, so loose types are fine there.
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
