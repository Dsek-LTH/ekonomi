declare module "heic-decode" {
  interface DecodedHeic {
    width: number;
    height: number;
    data: Uint8ClampedArray<ArrayBuffer>;
  }
  export default function decode(input: { buffer: Uint8Array }): Promise<DecodedHeic>;
}
