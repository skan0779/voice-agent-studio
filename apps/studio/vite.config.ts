import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          flow: ["@xyflow/react"],
          radix: ["@radix-ui/react-dialog", "@radix-ui/react-tooltip"],
        },
      },
    },
  },
});
