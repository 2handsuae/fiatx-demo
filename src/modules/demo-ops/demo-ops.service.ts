// 云端演示自助还原（spec 2026-09-13-cloud-demo-ops-buttons-design.md §3）。
import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'node:fs';

const EXIT_DELAY_MS = 500; // 让 202 响应先飞出去再退进程

@Injectable()
export class DemoOpsService {
  private readonly logger = new Logger(DemoOpsService.name);

  /** 状态：run/status 文件（云端开机序列写的重铺进度）。 */
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
    return { boot };
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
}
