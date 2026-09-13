// src/modules/sumsub-shared/demo-scenario.base.ts
import { BadRequestException, Body, Get, Post, Req } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { KYT_ONHOLD_TYPE } from './kyt-webhook-types';
import { KytVerdict } from './sumsub-txn.types';

/**
 * 充值 / 提现两域 demo 场景仿真器 + admin demo 控制器的公共底座（swap 域独立
 * 演进，一行不进本文件——业主 2026-09-13 定案：兑换逻辑零改动）。
 *
 * 服务侧只收「逐字相同」的三块：actor 形状、webhookType→verdict 归一映射表、
 * txnId 铸造算法；`runVerdict()` 本体（驱动 ingestion 的剧本步骤）是各域状态机
 * 专属，留在 DepositDemoScenarioService / WithdrawDemoScenarioService 自己身上，
 * 不进这里。
 */
export interface DemoScenarioActor {
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

/**
 * webhookType → 归一 verdict，与 DepositKytVerdictHandler / WithdrawKytVerdictHandler
 * 的 VERDICT_BY_TYPE 同源同值（两域此前各自声明一份逐字相同的表）。
 */
export const VERDICT_OF: Record<string, KytVerdict> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  [KYT_ONHOLD_TYPE]: 'onHold',
};

/**
 * 把 fixture 的槽位名铸成一个真实形态的 Sumsub KYT txnId。
 *
 * Sumsub 的 txnId 是 24 位小写 hex(MongoDB ObjectId 形态:4 字节时间戳 + 8 字节
 * 随机/计数),不是 `T3` 这种。这里 4 字节时间戳取该笔单的创建时刻(报送时点
 * 就在建单之后,时间上也说得通),后 8 字节由 (业务单号, 槽位) 哈希而来。
 *
 * 三个性质缺一不可:
 *   ① **形态真实** —— 界面/日志/客服工单里贴出去和真 Sumsub 控制台对得上号;
 *   ② **同单同槽稳定** —— 同一按钮重复喂是幂等重放,不会每次换号;
 *   ③ **跨单绝不重号** —— 此前 fixture 把 `T3` 当真 id 直接用,第二笔单跑同一场景时
 *      `findBySumsubTxnId('T3')` 会匹到**上一笔**单,端点照样返回 201 且事件全部
 *      PROCESSED、零报错,但驱动的是错误的单(2026-07-29 live demo 实测踩中)。
 *
 * ⚠️ 调用方(两域 runVerdict() 里的 createdAtIso)同样依赖「createdAt 是非空且带
 * @default(now()) 的 DB 列」这一不变量(prisma/schema.prisma 保证),所以不做
 * 运行时兜底;若将来该列变可空,两处要一起改。
 */
export function mintDemoTxnId(businessNo: string, createdAt: Date | string, slot: string): string {
  const digest = createHash('sha1').update(`${businessNo}:${slot}`).digest('hex');
  const ms = new Date(createdAt).getTime();
  const tsHex = Math.floor(ms / 1000).toString(16).padStart(8, '0').slice(-8);
  return `${tsHex}${digest.slice(0, 16)}`;
}

export interface DemoVerdictButtonSummary {
  key: string;
  label: string;
  source: string;
}

export interface DemoScenarioRunner {
  runVerdict(entityId: string, buttonKey: string, actor: DemoScenarioActor): Promise<Record<string, unknown>>;
}

/**
 * admin demo 控制器公共骨架。抽出的是「run-verdict 请求体校验 + 从 req.user
 * 拼 actor + 转发给域 DemoScenarioService」与「verdict-buttons 列表投影」——
 * 这两段两域除了请求体字段名(depositId/withdrawId)与按钮表外逐字一致。
 *
 * @Controller / @ApiTags / @ApiBearerAuth / @UseGuards 与构造注入(域专属的
 * DemoScenarioService 具体类型)留在子类——同 KytVerdictHandlerBase 的 DI 限制:
 * 具体 provider token 要出现在构造函数参数的具体类型上才能被 Nest 反射到,放进
 * 基类会被类型擦除。基类里的 @Post/@Get/@Body/@Req 装饰器在子类实例上一样生效
 * ——NestJS 路由方法用 MetadataScanner.getAllMethodNames 沿原型链上溯发现
 * (同 SlaSweepBase 的 @Cron 证据),参数装饰器(ROUTE_ARGS_METADATA)与路径元数据
 * 都以 `Reflect.getMetadata(key, instance.constructor, methodName)` 读取——
 * `Reflect.getMetadata`(区别于 `getOwnMetadata`)本身就会沿构造函数的原型链
 * (`class Sub extends Base` 令 `Sub.__proto__ === Base`)上溯,故基类方法上定义
 * 的装饰器元数据在子类实例上原样可查到(2026-09-13 复核
 * node_modules/@nestjs/core/helpers/context-utils.js 与
 * node_modules/@nestjs/common/decorators/http/route-params.decorator.js 源码确认)。
 *
 * idField / verdictButtons 是两域唯一的请求体字段名与按钮表差异,子类以
 * protected 字段满足下面的抽象成员(同 SlaSweepBase 的 domainLabel 写法)。
 *
 * @ApiOperation 的 summary 文案原本两域各写死"deposit"/"withdrawal"——这纯是
 * Swagger 文档字符串,不参与路由/RBAC/任何断言,归一成中性的"transaction"不改变
 * 任何可观察行为。
 */
export abstract class DemoScenarioControllerBase {
  protected abstract readonly demoScenarioService: DemoScenarioRunner;
  /** 请求体里承载业务单 id 的字段名——'depositId' | 'withdrawId' */
  protected abstract readonly idField: string;
  protected abstract readonly verdictButtons: Record<string, DemoVerdictButtonSummary>;

  @Post('run-verdict')
  @ApiOperation({ summary: 'Feed one Sumsub KYT verdict webhook into this transaction (demo only)' })
  async runVerdict(@Body() body: Record<string, string | undefined>, @Req() req: any) {
    const entityId = body?.[this.idField];
    if (!entityId) throw new BadRequestException(`${this.idField} is required`);
    if (!body?.verdict) throw new BadRequestException('verdict is required');

    const actor: DemoScenarioActor = {
      actorId: req.user?.userId,
      actorNo: req.user?.userNo,
      actorRole: req.user?.role,
    };
    return this.demoScenarioService.runVerdict(entityId, body.verdict, actor);
  }

  @Get('verdict-buttons')
  @ApiOperation({ summary: '列出本域可用的裁决按钮（demo only）—— 前端据此渲染 ⚡ 面板' })
  listVerdictButtons(@Req() req: any) {
    return {
      buttons: Object.values(this.verdictButtons).map((b) => ({
        key: b.key, label: b.label, source: b.source,
      })),
    };
  }
}
