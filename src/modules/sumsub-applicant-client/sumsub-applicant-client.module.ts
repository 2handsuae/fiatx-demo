import { Module } from '@nestjs/common';
import { SumsubClient } from './sumsub.client';

// 站6（2026-08-27）：申请人侧 Sumsub 客户端从 OnboardingModule 抽出成零依赖叶子。
// 一期入驻流程拆除（业主方案2）时发现 SumsubClient 早已是全域共享件——材料请求/
// 材料刷新/摄取枢纽都在用，住在一期模块里只是历史住址。镜像 SumsubTxnClientModule
// （交易侧 KYT 客户端）的叶子范式：类直供直出，无令牌无依赖。
@Module({
  providers: [SumsubClient],
  exports: [SumsubClient],
})
export class SumsubApplicantClientModule {}
