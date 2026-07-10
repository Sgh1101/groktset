import js from "@eslint/js";

export default [
  {
    ignores: ["node_modules/**", "backups/**"],
  },
  js.configs.recommended,
  {
    files: ["server/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    files: ["public/js/**/*.js", "public/sw.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        crypto: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        caches: "readonly",
        self: "readonly",
        URL: "readonly",
        Uint8Array: "readonly",
        QRCode: "readonly",
      },
    },
  },
];
