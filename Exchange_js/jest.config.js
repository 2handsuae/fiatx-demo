module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'ES2021',
          strict: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/scripts/require-node.js'],
  // client-web 用 vitest（见 client-web/package.json 的 test 脚本）。此前它在
  // roots 里，于是 jest 会捡起 client-web/src 下的 *.spec.ts：写法用裸全局的
  // 3 个被重复跑一遍，显式 import vitest 的 restrictedCapabilities.spec.ts
  // 当场失败——这就是常年挂在红名单里那条。admin-web 无 vitest，保留在这里。
  // scripts/ 也在内：jest 只在 roots 列出的目录里**发现**测试文件，不在其中的
  // 目录放多少 spec 都是 'No tests found'——不红也不绿，等于不存在（假绿）。
  // 2026-08-29 造数花名册那轮踩过一次，当时把 spec 挪进 src/ 反向 import 回
  // scripts/ 绕过去了；2026-09-01 直接把 scripts 纳入，陷阱填上。
  roots: ['<rootDir>/src', '<rootDir>/admin-web/src', '<rootDir>/scripts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};
