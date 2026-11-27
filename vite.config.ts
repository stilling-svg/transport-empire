import { defineConfig } from 'vitest/config';

// Relative base path so the build also works on GitHub Pages under /transport-empire/.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 600_000,
  },
});
