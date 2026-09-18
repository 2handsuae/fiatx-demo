import { defineConfig } from 'vitest/config';

// spec 文件不 import { describe, it, expect }（沿用 jest 风格的全局），
// 故必须开 globals；不开的话所有 spec 会以 "describe is not defined" 整体失败。
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
});
