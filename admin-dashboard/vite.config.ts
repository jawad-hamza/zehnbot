import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // the widget bundle, so /preview.html works in dev too
      "/static": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
