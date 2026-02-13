export const DEFAULT_CLEARING_TEMPLATES = [
  {
    code: 'WITHDRAWAL_STANDARD_V1',
    clearingType: 'WITHDRAWAL',
    sourceType: 'WITHDRAWAL',
    description: '标准提现清分模板：计算手续费',
    isEnabled: true,
    feeMethod: 'CONFIGURED_FEE',
    outAssetSource: 'src.assetId',
    outAmountSource: 'src.amount',
    inAssetSource: 'src.assetId',
    inAmountSource: 'src.netAmount',
    feeAssetSource: 'src.assetId',
    feeAmountSource: 'src.feeAmount',
    lineTemplates: [
      {
        lineNo: 1,
        lineType: 'FEE',
        partyType: 'PLATFORM',
        assetSource: 'src.assetId',
        amountSource: 'src.feeAmount',
      },
      {
        lineNo: 2,
        lineType: 'OUTGOING',
        partyType: 'CUSTOMER',
        partyIdSource: 'src.ownerId',
        assetSource: 'src.assetId',
        amountSource: 'src.netAmount',
      }
    ],
  },
];
