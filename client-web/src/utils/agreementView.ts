// client-web/src/utils/agreementView.ts
//
// 战役丙波三 T7 · 客户协议的接口形状 + /agreement 阅读页"版本状态头"的纯函数。
// 状态头文案集中登记在 STATUS_COPY（页面禁散写）；渲染靠截图闸，这里只管"该说什么"，
// 抽成纯函数供 vitest（客户端测不了渲染）。
//
// 形状与后端 AgreementsClientController 白名单一致：版本四键 + consent 五键；
// /me 响应 = current / pending / previous（已退位的最近一版）/ consent 四键。

export type AgreementSection = {
  no: string;
  title: string;
  body: string[];
};

export type AgreementVersion = {
  versionKey: string;
  effectiveAt: string | null;
  summary: string;
  sections: AgreementSection[];
};

export type AgreementConsent = {
  acceptedVersionKey: string | null;
  acceptedAt: string | null;
  acceptedCurrent: boolean;
  acceptedPending: boolean;
  declinedCurrentAt: string | null;
};

export type AgreementMe = {
  current: AgreementVersion;
  pending: AgreementVersion | null;
  /** 最近一个已退位（SUPERSEDED）版；生效翻转之后旧版仍可对照阅读。无则 null。 */
  previous: AgreementVersion | null;
  consent: AgreementConsent;
};

export type AgreementTabKey = 'previous' | 'current' | 'pending';

export type AgreementTab = { key: AgreementTabKey; version: AgreementVersion; tag: string };

const TAB_TAGS: Record<AgreementTabKey, string> = {
  previous: 'Superseded',
  current: 'In effect',
  pending: 'Upcoming',
};

/**
 * 阅读页版本切换组的数据源：[previous?, current, pending?]，有啥给啥；
 * 调用方在 length >= 2 时才渲染切换钮（单版没有可对照的东西）。
 */
export const agreementVersionTabs = (me: Pick<AgreementMe, 'previous' | 'current' | 'pending'>): AgreementTab[] => {
  const tabs: AgreementTab[] = [];
  if (me.previous) tabs.push({ key: 'previous', version: me.previous, tag: TAB_TAGS.previous });
  tabs.push({ key: 'current', version: me.current, tag: TAB_TAGS.current });
  if (me.pending) tabs.push({ key: 'pending', version: me.pending, tag: TAB_TAGS.pending });
  return tabs;
};

/**
 * 注册页条款抽屉的页眉两处（原先写死 `Issued · 2025.IV · Dubai, UAE` / `Version 1.0`）。
 * 取到生效版即用其 versionKey 与生效日（本地日 YYYY.MM.DD，贴原字样的点分风格）；
 * 没取回 / 取失败时原样回落原字面，别空着。
 */
export const DRAWER_BYLINE_FALLBACK = { issued: 'Issued · 2025.IV · Dubai, UAE', version: 'Version 1.0' } as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

export const agreementDrawerByline = (
  current: Pick<AgreementVersion, 'versionKey' | 'effectiveAt'> | null,
): { issued: string; version: string } => {
  if (!current) return { ...DRAWER_BYLINE_FALLBACK };
  const d = current.effectiveAt ? new Date(current.effectiveAt) : null;
  return {
    issued: d
      ? `Effective · ${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} · Dubai, UAE`
      : DRAWER_BYLINE_FALLBACK.issued,
    version: `Version ${current.versionKey}`,
  };
};

export const STATUS_COPY = {
  accepted: (versionKey: string, at: string) => `You accepted version ${versionKey} on ${at}.`,
  awaiting: (versionKey: string) =>
    `Version ${versionKey} is in effect and still needs your acceptance.`,
  declined: (at: string) => `You declined it on ${at}.`,
  pendingNotice: (versionKey: string, at: string) => `A new version ${versionKey} takes effect on ${at}.`,
  pendingAccepted: 'You have already accepted it.',
  dateUnknown: 'a date to be confirmed',
} as const;

export type AgreementStatusLine =
  | { kind: 'ACCEPTED'; text: string }
  | { kind: 'AWAITING_CONSENT'; text: string; acceptVersionKey: string }
  | { kind: 'PENDING_NOTICE'; text: string };

const defaultFormat = (iso: string): string => new Date(iso).toLocaleString();

/**
 * 状态头三态（由 me.consent 五键推出，不另读别的字段）：
 * - acceptedCurrent=true            → ACCEPTED（"已同意 vX 于某时"，取 acceptedVersionKey/acceptedAt）
 * - acceptedCurrent=false           → AWAITING_CONSENT（生效版待表态 + 同意按钮；曾拒绝则追加拒绝时刻）
 * - pending 非空（与上两者并存）   → PENDING_NOTICE（在途新版将于某日生效；acceptedPending 则追加"已提前同意"）
 */
export const agreementStatusLines = (
  me: AgreementMe,
  format: (iso: string) => string = defaultFormat,
): AgreementStatusLine[] => {
  const { current, pending, consent } = me;
  const lines: AgreementStatusLine[] = [];

  if (consent.acceptedCurrent) {
    lines.push({
      kind: 'ACCEPTED',
      text: STATUS_COPY.accepted(
        consent.acceptedVersionKey ?? current.versionKey,
        consent.acceptedAt ? format(consent.acceptedAt) : STATUS_COPY.dateUnknown,
      ),
    });
  } else {
    const declined = consent.declinedCurrentAt ? ` ${STATUS_COPY.declined(format(consent.declinedCurrentAt))}` : '';
    lines.push({
      kind: 'AWAITING_CONSENT',
      text: `${STATUS_COPY.awaiting(current.versionKey)}${declined}`,
      acceptVersionKey: current.versionKey,
    });
  }

  if (pending) {
    const accepted = consent.acceptedPending ? ` ${STATUS_COPY.pendingAccepted}` : '';
    lines.push({
      kind: 'PENDING_NOTICE',
      text: `${STATUS_COPY.pendingNotice(
        pending.versionKey,
        pending.effectiveAt ? format(pending.effectiveAt) : STATUS_COPY.dateUnknown,
      )}${accepted}`,
    });
  }

  return lines;
};
