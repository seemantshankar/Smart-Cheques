// ESLint flat config for Vite + React + TypeScript (minimal)
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { 
      parserOptions: { 
        project: "./tsconfig.json",
        ecmaVersion: 2023, 
        sourceType: "module" 
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        atob: "readonly",
        btoa: "readonly"
      }
    },
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-undef": "off"
    }
  }
];