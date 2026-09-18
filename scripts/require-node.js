// jest setupFiles 用的版本断言。
//
// 为什么：Node 18 缺 globalThis.crypto（Node ≥19 才有），在 18 上跑测试会得到
// 一片 "crypto is not defined" 的红——那是验收台的问题，不是代码的问题。
// 本仓库 2026-08-31 把 21 个手写 webcrypto 垫片清掉后，这类红会更多更散，
// 所以这里 fail-fast，给一句能看懂的话，而不是一屏红。
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  throw new Error(
    `本仓库要求 Node >= 20，当前 v${process.versions.node}。\n` +
      `修法：nvm use 20（或 nvm install 20）。\n` +
      `说明：.nvmrc / package.json engines / @nestjs/core 均要求 20；Node 18 缺 globalThis.crypto。`,
  );
}
