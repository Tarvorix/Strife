import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/Strife/",
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@game": resolve(__dirname, "src/game"),
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        editor: resolve(__dirname, "editor.html"),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
