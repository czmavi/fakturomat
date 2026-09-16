import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [fresh(), tailwindcss()],
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          // Credential provider chunks must not import the server entry:
          // that creates a cycle with main.ts's startup await. Deno resolves
          // these external imports using the existing deno.json import map.
          external: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
        },
      },
    },
  },
});
