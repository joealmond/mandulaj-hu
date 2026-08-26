// wawoff2 ships no type declarations. Only `compress` is used here.
declare module "wawoff2" {
  export function compress(input: Uint8Array | Buffer): Promise<Uint8Array>
  export function decompress(input: Uint8Array | Buffer): Promise<Uint8Array>
}
