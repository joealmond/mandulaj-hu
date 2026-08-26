import path from "node:path"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.resolve(import.meta.dirname, "../migrations"))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./worker/wrangler.test.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            VISITOR_SALT: "worker-test-visitor-salt-that-is-long-enough",
            TURNSTILE_SECRET_KEY: "worker-test-turnstile-secret",
          },
        },
      }),
    ],
    test: {
      include: ["worker/**/*.worker.spec.ts"],
      setupFiles: ["./worker/fixtures/apply-migrations.ts"],
    },
  }
})
