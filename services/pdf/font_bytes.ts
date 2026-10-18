import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Vite replaces this module with embedded bytes for Workers; Deno tests read the same fonts.
import { readFile } from "node:fs/promises";
export async function fontBytes(bold: boolean): Promise<Uint8Array> {
  const name = bold ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf";
  return new Uint8Array(
    await readFile(require.resolve(`dejavu-fonts-ttf/ttf/${name}`)),
  );
}
