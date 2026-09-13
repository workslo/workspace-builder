import { mergeConfig } from 'vite';
import { defineConfig as defineVitestConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default Object.assign({}, viteConfig, defineVitestConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
}));
