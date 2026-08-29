import { build } from "esbuild"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"

const shared = {
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["preact", "preact/*", "@quartz-community/*"],
}

await build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/index.js" })
execFileSync(
  "npx",
  [
    "tsc",
    "--ignoreConfig",
    "--declaration",
    "--emitDeclarationOnly",
    "--outDir",
    "dist",
    "--rootDir",
    "src",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--target",
    "ES2022",
    "--skipLibCheck",
    "src/index.ts",
  ],
  { stdio: "inherit" },
)

mkdirSync("dist/components", { recursive: true })
writeFileSync(
  "dist/components/index.js",
  'export * from "../index.js"\nexport { default } from "../index.js"\n',
)
writeFileSync(
  "dist/components/index.d.ts",
  'export * from "../index.js"\nexport { default } from "../index.js"\n',
)
console.log("built lazy-graph")
