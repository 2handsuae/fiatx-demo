// client-web/src/utils/agreementGate.ts
//
// 战役丙波三 T8 · 客户协议弹窗/横幅的四态判定（纯函数，供 AgreementGate 组件消费，vitest 表驱动）。
// 只读 GET /client/agreements/me 已给的 pending + consent 五键，不自己推任何合规条件。
import type { AgreementMe } from './agreementView';

export type AgreementGateState =
  | 'NONE' //                 无需打扰（已同意生效版，且无在途版 / 已提前同意在途版）
  | 'PENDING_DISMISSIBLE' //  已同意生效版，但有在途新版尚未提前同意 → 可关弹窗
  | 'EFFECTIVE_BLOCKING' //   生效版未同意且从未拒绝 → 强制弹窗（不可关）
  | 'DECLINED_BANNER'; //     生效版未同意且拒绝过 → 横幅常驻

/** 生效版优先：只要生效版没同意，在途版的任何状态都不改变结论（④⑤）。 */
export const agreementGateState = (me: Pick<AgreementMe, 'pending' | 'consent'>): AgreementGateState => {
  const { consent, pending } = me;
  if (!consent.acceptedCurrent) {
    return consent.declinedCurrentAt ? 'DECLINED_BANNER' : 'EFFECTIVE_BLOCKING';
  }
  if (pending && !consent.acceptedPending) return 'PENDING_DISMISSIBLE';
  return 'NONE';
};

const AGREEMENT_PAGE_PATH = '/agreement';

/**
 * 两种弹窗在 /agreement 阅读页上让位：人已经在读原文，页内状态头自带 Accept，不再盖一层。
 * 只管「当前路径」这一个渲染条件；表态状态仍由 agreementGateState 单独判定，不混入 location。
 * 横幅不是弹窗，不让位。路径比较与 react-router 同口径（忽略大小写与尾斜杠）。
 */
export const shouldSuppressModal = (state: AgreementGateState, pathname: string): boolean => {
  if (state !== 'EFFECTIVE_BLOCKING' && state !== 'PENDING_DISMISSIBLE') return false;
  return pathname.replace(/\/+$/, '').toLowerCase() === AGREEMENT_PAGE_PATH;
};

/**
 * 同意/拒绝落库后由发起方 window.dispatchEvent(new Event(...))，AgreementGate 监听后重取 me，
 * 横幅/弹窗随即消失，无需整页刷新（与 customer-auth-changed 同款自定义事件做法）。
 */
export const AGREEMENT_CONSENT_CHANGED_EVENT = 'agreement-consent-changed';
