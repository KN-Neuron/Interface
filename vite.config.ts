import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // The sidecars' Python environments and build outputs hold tens of thousands
      // of files; watching them exhausts Linux's inotify limit (ENOSPC).
      ignored: ["**/.venv/**", "**/*-sidecar/build/**", "**/*-sidecar/dist/**", "**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: ["es2021", "chrome100", "safari13"] },
});
