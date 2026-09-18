// 云端演示自助还原（spec 2026-09-13-cloud-demo-ops-buttons-design.md §3）。
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export type ReconBreakState = 'idle' | 'running' | 'done' | 'fail';

const TAIL_LINES = 40;
const EXIT_DELAY_MS = 500; // 让 202 响应先飞出去再退进程

@Injectable()
export class DemoOpsService {
  private readonly logger = new Logger(DemoOpsService.name);

  private reconBreak: { state: ReconBreakState; tail: string[]; finishedAt: string | null } = {
    state: 'idle',
    tail: [],
    finishedAt: null,
  };

  /** 状态双源合并：run/status 文件（云端开机序列写的重铺进度）+ recon-break 子进程内存态。 */
  readStatus() {
    const path = process.env.DEMO_STATUS_PATH;
    let boot = 'UNKNOWN'; // DEMO_STATUS_PATH 未设或文件缺失即此形态（本地验收）
    if (path) {
      try {
        boot = readFileSync(path, 'utf8').trim() || 'UNKNOWN';
      } catch {
        boot = 'UNKNOWN';
      }
    }
    return { boot, reconBreak: this.reconBreak };
  }

  /** 重铺 = 进程自退：demo-run.sh 守护见 API 退出即整服务 exit 1，systemd 重启并从零重铺。 */
  requestReset() {
    const path = process.env.DEMO_STATUS_PATH;
    if (path) {
      try {
        writeFileSync(path, 'STARTING:reset-requested\n'); // 消除「点击后 status 仍是 READY」窗口期
      } catch (e) {
        this.logger.warn(`demo-ops: cannot pre-mark status file: ${String(e)}`);
      }
    }
    this.logger.warn('demo-ops: reset requested — exiting so systemd re-seeds from scratch');
    setTimeout(() => process.exit(1), EXIT_DELAY_MS);
    return { accepted: true as const };
  }

  /** 重摆对账场景：子进程跑 recon:demo:break（脚本自清足迹可重复跑；env/cwd 继承主进程）。 */
  startReconBreak() {
    this.reconBreak = { state: 'running', tail: [], finishedAt: null };
    const child = spawn('npm', ['run', 'recon:demo:break'], { cwd: process.cwd(), env: process.env });
    const push = (chunk: Buffer) => {
      const lines = chunk
        .toString()
        .split('\n')
        .filter((l) => l.trim().length > 0);
      this.reconBreak.tail = [...this.reconBreak.tail, ...lines].slice(-TAIL_LINES);
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('error', (err) => {
      this.reconBreak.state = 'fail';
      this.reconBreak.tail = [...this.reconBreak.tail, String(err)].slice(-TAIL_LINES);
      this.reconBreak.finishedAt = new Date().toISOString();
    });
    child.on('close', (code) => {
      this.reconBreak.state = code === 0 ? 'done' : 'fail';
      this.reconBreak.finishedAt = new Date().toISOString();
    });
    return { accepted: true as const };
  }
}
