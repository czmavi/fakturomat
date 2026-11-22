import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const freshPlugins = fresh();
for (const plugin of freshPlugins) {
  if (plugin.name === "deno" && typeof plugin.resolveId === "function") {
    // Rolldown omits import attributes for ordinary imports. Fresh expects a map.
    const resolve = plugin.resolveId;
    plugin.resolveId = function (id, importer, options) {
      return resolve.call(this, id, importer, {
        ...options,
        attributes: options.attributes ?? {},
      });
    };
  }
}

export default defineConfig({
  plugins: [
    {
      name: "invoice-pdf-fonts",
      enforce: "pre",
      load(id) {
        if (!id.endsWith("/services/pdf/font_bytes.ts")) return;
        const fonts = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) =>
          Buffer.from(
            readFileSync(require.resolve(`dejavu-fonts-ttf/ttf/${name}`)),
          ).toString("base64")
        );
        return `const fonts = ${
          JSON.stringify(fonts)
        }; export async function fontBytes(bold) { return Uint8Array.from(atob(fonts[bold ? 1 : 0]), c => c.charCodeAt(0)); }`;
      },
    },
    freshPlugins,
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
  ],
});
