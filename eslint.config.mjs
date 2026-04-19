// ESLint v9 flat config. `eslint-config-next` v16 ships a flat-config
// export, so we just re-export it as the project config. Replaces the
// legacy `.eslintrc.json` (which ESLint v9 ignores), keeping the same
// `next/core-web-vitals` ruleset that the rest of the project expects.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const ignores = {
  ignores: [
    ".next/**",
    "node_modules/**",
    "out/**",
    "dist/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ],
};

const configs = Array.isArray(nextCoreWebVitals)
  ? nextCoreWebVitals
  : [nextCoreWebVitals];

export default [ignores, ...configs];
