// micromorph 0.4.5 ships declarations but does not expose them through its
// package.json `exports` map. Keep the narrow API Quartz uses available under
// TypeScript's modern package-exports-aware module resolution.
declare module "micromorph" {
  export default function micromorph(from: Node, to: Node): Promise<void>
}
