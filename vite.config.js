import { defineConfig } from "vite";

// Set BASE_PATH when building for a GitHub Pages *project* site, e.g.:
//   BASE_PATH=/BarcodeScannerApp/ npm run build
// Leave unset for local dev or a GitHub Pages *user* site (username.github.io).
export default defineConfig({
  base: process.env.BASE_PATH || "/",
});
