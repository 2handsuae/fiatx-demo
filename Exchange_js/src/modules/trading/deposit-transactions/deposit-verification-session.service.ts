import { Injectable } from '@nestjs/common';

// 2026-08-17 材料请求账：本服务的职责（按 seq 取会话 / 提交）已并入
// material-requests.client.controller.ts，按 requestNo 定位。
// 文件在 Task 12 统一删除（G3：加法在前、删除在后）。
@Injectable()
export class DepositVerificationSessionService {}
