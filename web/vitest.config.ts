import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirrors tsconfig "paths" ("@/*" -> "./*") so tests can import route handlers directly.
export default defineConfig({
  // tsconfig keeps JSX for Next.js ("preserve"); tests of components need it compiled
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) }
  }
});
