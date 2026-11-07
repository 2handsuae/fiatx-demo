import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DemoOpsService } from './demo-ops.service';

describe('DemoOpsService', () => {
  // ⚠️ 环境变量恢复用「显式赋空串」而非 delete：@prisma/client 的 runtime 自带
  // dotenv.config()（不覆盖已存在 key），delete 掉的 key 会被 worktree 根 .env
  // 里的值悄悄填回（本地验收时 .env 恰好会写 DEMO_OPS=1）——deposit-demo.module.spec.ts
  // 文件头的同一个坑。
  const ORIGINAL_STATUS_PATH = process.env.DEMO_STATUS_PATH;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'demo-ops-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (ORIGINAL_STATUS_PATH === undefined) {
      process.env.DEMO_STATUS_PATH = '';
    } else {
      process.env.DEMO_STATUS_PATH = ORIGINAL_STATUS_PATH;
    }
    jest.useRealTimers();
  });

  describe('readStatus', () => {
    it('DEMO_STATUS_PATH 未设 → boot=UNKNOWN（本地验收形态）', () => {
      process.env.DEMO_STATUS_PATH = '';
      const svc = new DemoOpsService();
      expect(svc.readStatus()).toEqual({ boot: 'UNKNOWN' });
    });

    it('文件不存在 → boot=UNKNOWN 不抛错', () => {
      process.env.DEMO_STATUS_PATH = join(tmpDir, 'no-such-file');
      const svc = new DemoOpsService();
      expect(svc.readStatus().boot).toBe('UNKNOWN');
    });

    it('文件存在 → 返回去空白后的原文', () => {
      const p = join(tmpDir, 'status');
      writeFileSync(p, 'STARTING:7 demo:all\n');
      process.env.DEMO_STATUS_PATH = p;
      const svc = new DemoOpsService();
      expect(svc.readStatus().boot).toBe('STARTING:7 demo:all');
    });
  });

  describe('requestReset', () => {
    it('先覆写状态文件为 reset-requested，再延时 process.exit(1)', () => {
      jest.useFakeTimers();
      const p = join(tmpDir, 'status');
      writeFileSync(p, 'READY\n');
      process.env.DEMO_STATUS_PATH = p;
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      const svc = new DemoOpsService();
      expect(svc.requestReset()).toEqual({ accepted: true });
      expect(svc.readStatus().boot).toBe('STARTING:reset-requested'); // 消除 READY 窗口期
      expect(exitSpy).not.toHaveBeenCalled(); // 202 响应要先飞出去
      jest.advanceTimersByTime(600);
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it('DEMO_STATUS_PATH 未设也不抛错（本地误按场景）', () => {
      jest.useFakeTimers();
      process.env.DEMO_STATUS_PATH = '';
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const svc = new DemoOpsService();
      expect(svc.requestReset()).toEqual({ accepted: true });
      jest.advanceTimersByTime(600);
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });
});
