import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Sandbox-friendly: avoid forked processes that can be hard to terminate.
    pool: "threads",
  },
});

