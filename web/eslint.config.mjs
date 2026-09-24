import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: ["node_modules/**", ".next/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Photos come from blob:/data: URLs and API-relative thumbnails; next/image
    // adds remote-pattern config and optimization overhead for none here.
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
