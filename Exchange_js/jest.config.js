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
  roots: ['<rootDir>/src', '<rootDir>/admin-web/src'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};
