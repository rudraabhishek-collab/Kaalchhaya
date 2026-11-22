import nextConfig from "eslint-config-next";
import jsxA11y from "eslint-plugin-jsx-a11y";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  // Next.js flat config (already includes jsx-a11y plugin + core-web-vitals + typescript rules)
  ...nextConfig,
  // Extend with the full jsx-a11y recommended rule set (plugin already registered by Next)
  {
    rules: {
      ...jsxA11y.configs.recommended.rules,
    },
  },
];

export default eslintConfig;
