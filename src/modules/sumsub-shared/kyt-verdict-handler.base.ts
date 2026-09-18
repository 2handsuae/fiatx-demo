// src/modules/sumsub-shared/kyt-verdict-handler.base.ts
import { Logger } from '@nestjs/common';
import { SumsubTxnClient } from './sumsub-txn-client.interface';
import { KytVerdict } from './sumsub-txn.types';
import { KYT_ONHOLD_TYPE } from './kyt-webhook-types';
import { SCENE_TAGS, SCENE_TAG_PRIORITY, type SceneTag, type DispoTag } from './scene-tags';

export type { SceneTag, DispoTag };

// payload.type → 归一 verdict；'ignore' = Reviewed/Created，不推进状态机。
// 充值 / 提现两域此前各自声明同一张表逐字一致（swap 域另演进，不进本表——
// 业主 2026-09-13 定案：兑换逻辑零改动），现收成单一真相源。
export const VERDICT_BY_TYPE: Record<string, KytVerdict | 'ignore'> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  [KYT_ONHOLD_TYPE]: 'onHold',
  applicantKytTxnReviewed: 'ignore',
  applicantKytTxnCreated: 'ignore',
};

// approved / onHold 也拉:证据对齐(score + 报文),但都不读处置 tag。
// onHold 语义是「规则已算完分、判定需人工复核」,分数与命中规则正是 officer 的决策依据;
// 此前 onHold 不拉,导致挂起单在详情页零证据(2026-07-31 实测 score/报文双空)。
export const DETAIL_LOOKUP_VERDICTS = new Set<KytVerdict>(['approved', 'rejected', 'awaitUser', 'onHold']);
// 标签不在 webhook 里,只在 rejected/awaitUser 时才读 typedTags。
export const TAG_LOOKUP_VERDICTS = new Set<KytVerdict>(['rejected', 'awaitUser']);

/**
 * 充值 / 提现两域 KYT 交易裁决 webhook 落地的公共骨架（swap 域独立演进，仍是
 * 单独的 swap-kyt-verdict.handler.ts——业主 2026-09-13 定案：充提共底座、
 * 兑换逻辑零改动）。
 *
 * 抽出的是「归一 verdict → 找行 → ignore/orphan 短路 → 命中详情裁决时按需拉
 * getTxn 证据 + 读处置 tag（含制裁/PEP 四档优先级去重）→ 落 applyVerdict」——
 * 这段两域除了下面几点外逐字一致（裁决映射表 VERDICT_BY_TYPE /
 * DETAIL_LOOKUP_VERDICTS / TAG_LOOKUP_VERDICTS 逐字相同，随基类一并收成
 * 上面的具名导出，deposit / withdraw 两个 handler 不再各自重复声明）：
 *
 * - findRow / applyVerdict：调用哪个域 Service 不同。NestJS DI 靠具体类型
 *   出现在构造函数参数上做反射取 provider token，放进泛型会被类型擦除、
 *   反射拿不到具体 token，所以真正的构造注入（含 workflow / 域 Service）
 *   留在子类，基类只收薄封装方法。
 * - handleRowNotFound：**不是同一逻辑，是两域现有真实分工不同，照抄不合并**
 *   ——deposit 找不到行只 debug + 返回 false（级联给 withdraw 是预期路径，见
 *   SumsubIngestionService 的三级分流，不该报噪音）；withdraw 找不到行会
 *   warn（2026-09-13 现场 diff 证实两域这里本就不对称，两域现有 spec 也各自
 *   断言了这个行为——任务铁律「级联语义不许动」，原样保留，不改成一致）。
 * - dispoTags：处置 tag 集合两域不同值（DISPO_TAGS_BY_DOMAIN.DEPOSIT /
 *   .WITHDRAW），类型仍是同一个 DispoTag 联合，作为简单字段留子类赋值
 *   （同 SlaSweepBase 的 domainLabel/softStatuses 写法）。
 * - sumsubTxnClient：两域都注入同一个 SUMSUB_TXN_CLIENT token，但构造注入
 *   本身仍要留在子类（同上 DI 限制），子类以 protected 字段满足本抽象成员。
 *
 * logger 字段名与两域现有 spec 直接 `(handler as any).logger` 取 spy 的用法
 * 保持兼容（挪进基类用 `this.constructor.name` 取类名，运行时字符串与改前
 * 逐字一致）。
 */
export abstract class KytVerdictHandlerBase {
  protected readonly logger = new Logger(this.constructor.name);

  protected abstract readonly sumsubTxnClient: SumsubTxnClient;
  protected abstract readonly dispoTags: ReadonlySet<DispoTag>;

  protected abstract findRow(kytTxnId: string): Promise<{ id: string } | null | undefined>;
  /** 找不到行时的域特定处理（debug 静默级联 vs warn 孤儿告警）——不落状态机,只负责打日志。 */
  protected abstract handleRowNotFound(kytTxnId: string): void;
  protected abstract applyVerdict(
    rowId: string,
    payload: {
      verdict: KytVerdict;
      riskScore: number | null;
      sceneTag?: SceneTag;
      dispoTag?: DispoTag;
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
    },
  ): Promise<void>;

  // 返回布尔 = "一笔本域行拥有这个 kytTxnId"——ignore 类型也做同一次查询
  // (indexed,便宜)只为回答归属,不触发工作流,供 SumsubIngestionService 级联分流用。
  async handle(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');
    const verdict = VERDICT_BY_TYPE[type];
    const kytTxnId = String(payload.kytTxnId ?? '');
    const row = await this.findRow(kytTxnId);

    if (!verdict || verdict === 'ignore') {
      this.logger.debug(`${this.constructor.name} ignoring type: ${type}`);
      return !!row;
    }

    if (!row) {
      this.handleRowNotFound(kytTxnId);
      return false;
    }

    let sceneTag: SceneTag | undefined;
    let dispoTag: DispoTag | undefined;
    // 风险分只有在已经拉了 txn 详情时才拿得到;approved 路径不额外多打一次 API
    // 换一个展示数字(留 null,前端显示 —)。
    let riskScore: number | null = null;
    let detailRaw: unknown;
    let applicantActions: { applicantActionId: string; externalActionId: string }[] | undefined;

    if (DETAIL_LOOKUP_VERDICTS.has(verdict)) {
      const detail = await this.sumsubTxnClient.getTxn(kytTxnId);
      riskScore = detail.riskScore ?? null;
      detailRaw = detail.raw;
      applicantActions = detail.applicantActions;
      if (TAG_LOOKUP_VERDICTS.has(verdict)) {
        for (const tag of detail.typedTags) {
          if (tag.type !== 'userDefined') continue;
          if (SCENE_TAGS.has(tag.label as SceneTag)) {
            const candidate = tag.label as SceneTag;
            if (!sceneTag || SCENE_TAG_PRIORITY[candidate] > SCENE_TAG_PRIORITY[sceneTag]) {
              sceneTag = candidate;
            }
          }
          if (this.dispoTags.has(tag.label as DispoTag)) dispoTag = tag.label as DispoTag;
        }
      }
    }

    await this.applyVerdict(row.id, {
      verdict,
      riskScore,
      ...(sceneTag && { sceneTag }),
      ...(dispoTag && { dispoTag }),
      ...(detailRaw !== undefined && { detailRaw }),
      ...(applicantActions?.length && { applicantActions }),
    });
    return true;
  }
}
