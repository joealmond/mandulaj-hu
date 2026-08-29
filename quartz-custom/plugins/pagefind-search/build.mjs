// Minimal esbuild step. Quartz's loader imports the built dist/, not src/.
// preact is external: the host provides it, and two copies would break hooks.
import { build } from "esbuild"
import { mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const shared = {
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  external: ["preact", "preact/*", "@quartz-community/*"],
}

await build({ ...shared, entryPoints: ["src/index.tsx"], outfile: "dist/index.js" })
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
    "--jsx",
    "react-jsx",
    "--jsxImportSource",
    "preact",
    "--skipLibCheck",
    "src/index.tsx",
  ],
  { stdio: "inherit" },
)

// The loader resolves components through the "./components" subpath.
mkdirSync("dist/components", { recursive: true })
writeFileSync(
  "dist/components/index.js",
  'export * from "../index.js"\nexport { default } from "../index.js"\n',
)
writeFileSync(
  "dist/components/index.d.ts",
  'export * from "../index.js"\nexport { default } from "../index.js"\n',
)
console.log("built pagefind-search")
