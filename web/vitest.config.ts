import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirrors tsconfig "paths" ("@/*" -> "./*") so tests can import route handlers directly.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) }
  }
});
