/**
 * 战役丙波三 T2：客户协议正文登记处——全仓唯一一份协议正文（客户端注册页 / 阅读页、管理台
 * 版本详情一律取接口，不得另存第二份副本；波三 plan「正文只许住登记处」）。
 *
 * 版本与状态在库（customer_agreement_versions），正文在此：正文是代码登记物，版本行里只有
 * versionKey/summary/生效日——"改正文"= 改本文件 + 新增一版，不是改库。
 *
 * 坑 11 基线声明：v1 以订正后文案收录为基线，「不可变」约束自入库起算。
 *   - 来源：client-web/src/pages/CustomerRegister.tsx 原 TERMS_SECTIONS 七节，逐字搬运
 *     （含标点，零改写），仅两处订正——两处 "14 days" 均改 30 天，依据 VARA Rulebook
 *     Market Conduct II.A.7 / II.B.1.e（变更须提前 30 日通知），两处不同改会自相矛盾：
 *       第 IV 节  fee schedule 更新通知期  14 days' → 30 days'
 *       第 VII 节 条款重大变更通知期       at least 14 days → at least thirty (30) calendar days
 *   - v1 一经入库不得再改；任何文案变动一律走新版本（v2、v3…）。
 *
 * v2 = v1 深拷贝 + 第 V 节（Liability & Dispute Resolution）追加一段投诉受理/处理时限，
 * 取自战役甲波五投诉主体的 7 / 28 / 56 天双钟（complaints 模块既有口径）。
 */

export type AgreementSection = {
  no: string;
  title: string;
  body: string[];
};

const V1_SECTIONS: AgreementSection[] = [
  {
    no: 'I',
    title: 'About FIATX',
    body: [
      'FIATX Financial Services Ltd is a virtual asset service provider licensed in Dubai by the Virtual Assets Regulatory Authority ("VARA") as a Category 2 VASP. The services described in these terms are provided under VARA Rulebook authorisation, and are governed exclusively by the laws of the Dubai International Financial Centre and the supervision of VARA.',
      'By opening an individual account, you are entering into a contract with FIATX. These terms, together with the Privacy Notice that appears as Part II of this document, form the entire agreement between you and us.',
    ],
  },
  {
    no: 'II',
    title: 'Eligibility & Identity Verification',
    body: [
      'You must be at least 21 years of age, a natural person acting on your own behalf, and not a resident of a sanctioned jurisdiction. We may decline any application at our sole discretion, including in response to risk signals from our sanctions and adverse-media screening providers.',
      'Customer due diligence is performed under VARA Compliance and Risk Management Rulebook Part D. Level-1 verification is required for every account; Level-2 (enhanced due diligence) is required for politically exposed persons, large inbound transfers, and accounts flagged by our risk engine.',
    ],
  },
  {
    no: 'III',
    title: 'Accepted Activities',
    body: [
      'You may use FIATX to: (a) convert UAE dirhams into supported virtual assets and back, (b) hold balances in the safeguarded client-asset account, and (c) instruct on-chain and domestic IBAN payouts subject to our travel-rule and sanctions-screening procedures.',
      'You may not use FIATX to: (a) move funds for any third party, (b) structure transactions to avoid reporting thresholds, (c) interact with services appearing on the OFAC, EU or UN consolidated sanctions lists, or (d) any activity prohibited by the FATF Recommendations.',
    ],
  },
  {
    no: 'IV',
    title: 'Fees, Settlement & Client Money',
    body: [
      'All applicable fees and spreads are published on our fee schedule and are updated with 30 days\' written notice. Settlement windows for dirham-denominated transactions are intraday (T+0) subject to UAE banking cut-off times.',
      'Client money is held under segregated safeguarding arrangements at VARA-approved banking partners. Daily reconciliation and monthly statement warehousing are performed under CRM Rulebook Part F. We do not rehypothecate client assets.',
    ],
  },
  {
    no: 'V',
    title: 'Liability & Dispute Resolution',
    body: [
      'Our liability to you is limited to direct losses caused by our own negligence or wilful default. We are not liable for losses arising from price movement, third-party custodians, network outages, or instructions we execute in accordance with your account authentication.',
      'Disputes are resolved through the VARA complaints procedure followed by arbitration under the DIFC-LCIA Arbitration Rules, seated in Dubai, conducted in English. Nothing in this clause limits your statutory rights under UAE federal consumer protection law.',
    ],
  },
  {
    no: 'VI',
    title: 'Privacy & Data Protection',
    body: [
      'Personal data is processed under the UAE Federal Personal Data Protection Law (PDPL) and CRM Rulebook Part E. Lawful bases for processing are: (i) performance of this contract, (ii) compliance with our regulatory obligations as a VASP, and (iii) legitimate interests in preventing financial crime.',
      'Categories of data collected: identity documents, biometric data (liveness video), transaction metadata, device and IP data, and communications with our support team. We retain these records for eight years after the end of our relationship, as required by the CRM Rulebook.',
      'Your rights: access, rectification, erasure (subject to retention obligations), portability, and objection to processing not based on consent. Data subject requests are handled by our Data Protection Officer at dpo@fiatx.ae within 30 days.',
    ],
  },
  {
    no: 'VII',
    title: 'How to Contact Us',
    body: [
      'Operations and account support: support@fiatx.ae · Compliance and MLRO: compliance@fiatx.ae · Data protection enquiries: dpo@fiatx.ae · Registered office: Level 41, Emirates Towers, Sheikh Zayed Road, Dubai.',
      'A printable PDF of these terms is available on request. We will notify you of any material change to these terms at least thirty (30) calendar days before the change takes effect.',
    ],
  },
];

const V2_COMPLAINTS_PARAGRAPH =
  'Complaints submitted through the in-app complaints channel are acknowledged within seven (7) days and resolved within twenty-eight (28) days, extendable once to fifty-six (56) days for complex cases. You will be notified of the outcome in writing.';

// v2 = v1 深拷贝（section 与 body 数组都新建，改 v2 不会回写 v1）+ 第 V 节追加一段。
const V2_SECTIONS: AgreementSection[] = V1_SECTIONS.map((s) => ({
  ...s,
  body: s.no === 'V' ? [...s.body, V2_COMPLAINTS_PARAGRAPH] : [...s.body],
}));

export const AGREEMENT_BODIES: Record<string, AgreementSection[]> = {
  v1: V1_SECTIONS,
  v2: V2_SECTIONS,
};
