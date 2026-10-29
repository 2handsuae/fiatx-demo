// admin-web/src/utils/vendorTypes.ts
// 甲波六 T8：后端 VendorView（OutsourcingVendorsService.toView）的前端镜像——服务商申请页与详情页共用这一份。
// 铁律⑥：投影零 id、零 UUID；用户是 userNo；日期是 ISO 串。
export interface VendorView {
  vendorNo: string;
  name: string;
  registeredIn: string;
  registrationNo: string;
  deliveryLocations: string[];
  contactName: string;
  contactEmail: string;
  beneficialOwners: { seq: number; name: string; nationality?: string }[];
  licensingAuthority: string | null;
  licenceNo: string | null;
  serviceDescription: string;
  regulatedFunction: boolean;
  involvesPersonalData: boolean;
  involvesConfidentialInfo: boolean;
  contractStart: string;
  contractEnd: string | null;
  annualFee: string | null;
  feeCurrency: string | null;
  subcontracts: boolean;
  subcontractorNames: string | null;
  applicationReason: string;
  impactLicence: boolean;
  impactLegal: boolean;
  impactFinancial: boolean;
  impactContinuity: boolean;
  replaceability: string;
  criticality: string;
  criticalityReason: string | null;
  status: string;
  approvalNo: string | null;
  notificationFilingNo: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}
