// heic-decode ships no types. Only the default export is used, in
// lib/server/images.ts and lib/ui/heic.ts.
declare module "heic-decode" {
  interface DecodedHeic {
    width: number;
    height: number;
    /** RGBA, four bytes per pixel. */
    data: Uint8ClampedArray<ArrayBuffer>;
  }
  export default function decode(input: { buffer: Uint8Array }): Promise<DecodedHeic>;
}
