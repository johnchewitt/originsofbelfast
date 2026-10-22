/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite configuration.
 *
 * `base` defaults to "./" so the built site works from any sub-path, which is
 * what GitHub Pages project sites need (https://<user>.github.io/<repo>/).
 * Override with VITE_BASE_PATH when deploying to a fixed root.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: env.VITE_BASE_PATH || "./",
    plugins: [react()],
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 6000,
      sourcemap: false,
    },
    server: { port: 5173 },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    },
  };
});
