import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Local LLM servers on this machine (LM Studio on :1234, Unsloth Studio on :8888) stay out of the
    // tests: Automatic would find them. Tests that need one start a stand-in and point Settings at it.
    env: { LMSTUDIO_URL: "http://127.0.0.1:9", UNSLOTH_URL: "http://127.0.0.1:9" },
  },
});
