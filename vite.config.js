// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,      // תמיד ננסה לעבוד על 5173
    strictPort: true // אם הפורט תפוס – נקבל שגיאה במקום לעבור לפורט אחר
  }
});
