import { WithdrawVerificationSessionService } from './withdraw-verification-session.service';

// 2026-08-18 材料请求账：本服务的职责（按 seq 取会话 / 提交）已并入
// material-requests.client.controller.ts，按 requestNo 定位——getSession/submit
// 连同它们的全部用例（响应体二字段守则、账不能删行、SLA 重置分支等）已跟着
// 方法一起搬走，由 material-requests 域的 spec 覆盖。本文件在 Task 12 随
// service 本体一并物理删除（G3：加法在前、删除在后），这里只留一条存活断言
// 防止空文件在 tsc/jest 下报"无测试用例"。
describe('WithdrawVerificationSessionService（残壳，Task 12 删除）', () => {
  it('可实例化，无公开方法', () => {
    const svc = new WithdrawVerificationSessionService();
    expect(svc).toBeInstanceOf(WithdrawVerificationSessionService);
  });
});
