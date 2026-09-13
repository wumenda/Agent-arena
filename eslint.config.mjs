import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 题库是刻意带 bug 的示例/用户项目，独立于主工程代码风格，不参与 lint
    "questions/**",
  ]),
  {
    // adapter 解析第三方 harness 的动态 JSONL、测试文件惯例豁免 no-explicit-any
    files: ["src/lib/arena/adapters/**/*.ts", "tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);

export default eslintConfig;
