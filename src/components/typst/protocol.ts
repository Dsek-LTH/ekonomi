/** A Typst template as the browser fetches it: the main file, and the files it reads by their path in the project. */
export interface TypstTemplate {
  main: string;
  files: Record<string, string>;
}

export interface TypstRequest {
  id: number;
  /** Where the compiler, renderer and fonts are served from. The same on every request; read on the first. */
  env: { compilerWasm: string; rendererWasm: string; fonts: string[] };
  template: TypstTemplate;
  data: unknown;
}

export type TypstResponse = { id: number; svg: string } | { id: number; error: string };
