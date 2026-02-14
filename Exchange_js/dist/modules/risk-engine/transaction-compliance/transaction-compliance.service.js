"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var TransactionComplianceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionComplianceService = void 0;
const common_1 = require("@nestjs/common");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const tx_compliance_types_1 = require("./types/tx-compliance.types");
const deposit_transaction_dto_1 = require("../../trading/deposit-transactions/dto/deposit-transaction.dto");
const withdraw_transaction_dto_1 = require("../../trading/withdraw-transactions/dto/withdraw-transaction.dto");
let TransactionComplianceService = TransactionComplianceService_1 = class TransactionComplianceService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(TransactionComplianceService_1.name);
    }
    getClient(tx) {
        return tx ?? this.prisma;
    }
    getProviderMode() {
        const configured = (process.env.TX_COMPLIANCE_PROVIDER_MODE || '').toUpperCase();
        if (configured === 'MOCK' || configured === 'MANUAL') {
            return configured;
        }
        return process.env.NODE_ENV === 'production' ? 'MANUAL' : 'MOCK';
    }
    serializePayload(payload) {
        if (payload === null || payload === undefined) {
            return null;
        }
        if (typeof payload === 'string') {
            return payload;
        }
        return JSON.stringify(payload);
    }
    generateCaseNo(prefix) {
        return (0, no_generator_util_1.generateReferenceNo)(prefix);
    }
    normalizeKytStatus(status) {
        const current = (status || 'PENDING').toUpperCase();
        if (current === 'CLEAR')
            return 'PASS';
        if (current === 'HOLD')
            return 'REVIEW';
        if (current === 'REJECT')
            return 'FAIL';
        if (['PENDING', 'PASS', 'REVIEW', 'FAIL'].includes(current)) {
            return current;
        }
        return 'PENDING';
    }
    normalizeTravelRuleStatus(status, required) {
        const current = (status || '').toUpperCase();
        if (!required && !current)
            return 'NOT_REQUIRED';
        if (!required && current === 'PENDING')
            return 'NOT_REQUIRED';
        if ([
            'NOT_REQUIRED',
            'PENDING',
            'SENT',
            'RECEIVED',
            'ACCEPTED',
            'REJECTED',
            'EXPIRED',
        ].includes(current)) {
            return current;
        }
        return required ? 'PENDING' : 'NOT_REQUIRED';
    }
    deriveWithdrawComplianceStatus(input) {
        const { preKytStatus, mainKytStatus, travelRuleStatus, travelRuleRequired, hasMain, hasPre, hasTravel, } = input;
        if (!hasPre || !hasMain || !hasTravel) {
            return 'PENDING';
        }
        if (preKytStatus === 'FAIL' || mainKytStatus === 'FAIL') {
            return 'REJECT';
        }
        if (travelRuleRequired && travelRuleStatus === 'REJECTED') {
            return 'REJECT';
        }
        if (preKytStatus === 'REVIEW' || mainKytStatus === 'REVIEW') {
            return 'HOLD';
        }
        if (travelRuleRequired &&
            ['PENDING', 'SENT', 'RECEIVED', 'EXPIRED'].includes(travelRuleStatus)) {
            return 'HOLD';
        }
        if (preKytStatus === 'PASS' &&
            mainKytStatus === 'PASS' &&
            (!travelRuleRequired || travelRuleStatus === 'ACCEPTED')) {
            return 'CLEAR';
        }
        return 'PENDING';
    }
    async resolveSourceContext(sourceType, sourceId, tx) {
        const client = this.getClient(tx);
        switch (sourceType) {
            case tx_compliance_types_1.TxSourceType.DEPOSIT: {
                const deposit = await client.depositTransaction.findUnique({
                    where: { id: sourceId },
                    select: {
                        id: true,
                        ownerType: true,
                        ownerId: true,
                        assetId: true,
                    },
                });
                if (!deposit) {
                    throw new common_1.NotFoundException(`Deposit ${sourceId} not found`);
                }
                return {
                    sourceType,
                    sourceId: deposit.id,
                    ownerType: deposit.ownerType,
                    ownerId: deposit.ownerId,
                    assetId: deposit.assetId,
                };
            }
            case tx_compliance_types_1.TxSourceType.WITHDRAW: {
                const withdraw = await client.withdrawTransaction.findUnique({
                    where: { id: sourceId },
                    select: {
                        id: true,
                        ownerType: true,
                        ownerId: true,
                        assetId: true,
                    },
                });
                if (!withdraw) {
                    throw new common_1.NotFoundException(`Withdraw ${sourceId} not found`);
                }
                return {
                    sourceType,
                    sourceId: withdraw.id,
                    ownerType: withdraw.ownerType,
                    ownerId: withdraw.ownerId,
                    assetId: withdraw.assetId,
                };
            }
            default:
                throw new common_1.BadRequestException(`sourceType ${sourceType} requires explicit ownerType/ownerId/assetId for mock APIs`);
        }
    }
    resolveManualSourceContext(input) {
        if (!input.ownerType || !input.assetId) {
            return null;
        }
        return {
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            ownerType: input.ownerType,
            ownerId: input.ownerId || null,
            assetId: input.assetId,
        };
    }
    buildMockKytPayload(input) {
        return {
            provider: 'MOCK',
            providerCaseId: input.providerCaseId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            stage: input.stage,
            status: input.status,
            riskScore: input.riskScore,
            hits: [],
        };
    }
    buildMockTravelPayload(input) {
        return {
            provider: 'MOCK',
            providerTransferId: input.providerTransferId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            required: input.required,
            status: input.status,
            counterpartyVasp: input.counterpartyVasp || null,
        };
    }
    async listKytCases(query) {
        const where = {};
        if (query.sourceType)
            where.sourceType = query.sourceType;
        if (query.sourceId)
            where.sourceId = query.sourceId;
        if (query.status)
            where.status = query.status;
        if (query.provider)
            where.provider = query.provider;
        if (query.screeningStage)
            where.screeningStage = query.screeningStage;
        const skip = query.skip ?? 0;
        const take = query.take ?? 20;
        const [items, total] = await Promise.all([
            this.prisma.kytCase.findMany({
                where,
                skip,
                take,
                orderBy: { updatedAt: 'desc' },
            }),
            this.prisma.kytCase.count({ where }),
        ]);
        return { items, total };
    }
    async listTravelRuleCases(query) {
        const where = {};
        if (query.sourceType)
            where.sourceType = query.sourceType;
        if (query.sourceId)
            where.sourceId = query.sourceId;
        if (query.status)
            where.status = query.status;
        if (query.provider)
            where.provider = query.provider;
        const skip = query.skip ?? 0;
        const take = query.take ?? 20;
        const [items, total] = await Promise.all([
            this.prisma.travelRuleCase.findMany({
                where,
                skip,
                take,
                orderBy: { updatedAt: 'desc' },
            }),
            this.prisma.travelRuleCase.count({ where }),
        ]);
        return { items, total };
    }
    async upsertKytCaseAndAppendReport(input, tx) {
        if (!input.assetId) {
            throw new common_1.BadRequestException('assetId is required for KYT case');
        }
        const client = this.getClient(tx);
        const provider = input.provider || 'MOCK';
        const status = this.normalizeKytStatus(input.status);
        const checkedAt = input.checkedAt ?? new Date();
        const providerCaseId = input.providerCaseId || null;
        const rawPayload = this.serializePayload(input.rawPayload);
        const normalizedPayload = this.serializePayload(input.normalizedPayload);
        const record = await client.kytCase.upsert({
            where: {
                sourceType_sourceId_screeningStage: {
                    sourceType: input.sourceType,
                    sourceId: input.sourceId,
                    screeningStage: input.screeningStage,
                },
            },
            create: {
                caseNo: this.generateCaseNo('KYT'),
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                screeningStage: input.screeningStage,
                ownerType: input.ownerType,
                ownerId: input.ownerId,
                assetId: input.assetId,
                provider,
                providerCaseId,
                status,
                riskScore: input.riskScore ?? null,
                checkedAt,
                latestRawPayload: rawPayload,
                latestNormalizedPayload: normalizedPayload,
            },
            update: {
                ownerType: input.ownerType,
                ownerId: input.ownerId,
                assetId: input.assetId,
                provider,
                providerCaseId,
                status,
                riskScore: input.riskScore ?? null,
                checkedAt,
                latestRawPayload: rawPayload,
                latestNormalizedPayload: normalizedPayload,
            },
        });
        const report = await client.kytCaseReport.create({
            data: {
                kytCaseId: record.id,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                screeningStage: input.screeningStage,
                provider,
                providerCaseId,
                rawPayload,
                normalizedPayload,
                receivedAt: checkedAt,
            },
        });
        return { case: record, report };
    }
    async upsertTravelRuleCaseAndAppendReport(input, tx) {
        if (!input.assetId) {
            throw new common_1.BadRequestException('assetId is required for Travel Rule case');
        }
        const client = this.getClient(tx);
        const provider = input.provider || 'MOCK';
        const required = input.required ?? false;
        const status = this.normalizeTravelRuleStatus(input.status, required);
        const checkedAt = input.checkedAt ?? new Date();
        const providerTransferId = input.providerTransferId || null;
        const rawPayload = this.serializePayload(input.rawPayload);
        const normalizedPayload = this.serializePayload(input.normalizedPayload);
        const record = await client.travelRuleCase.upsert({
            where: {
                sourceType_sourceId: {
                    sourceType: input.sourceType,
                    sourceId: input.sourceId,
                },
            },
            create: {
                caseNo: this.generateCaseNo('TRV'),
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                ownerType: input.ownerType,
                ownerId: input.ownerId,
                assetId: input.assetId,
                provider,
                providerTransferId,
                required,
                status,
                counterpartyVasp: input.counterpartyVasp || null,
                checkedAt,
                latestRawPayload: rawPayload,
                latestNormalizedPayload: normalizedPayload,
            },
            update: {
                ownerType: input.ownerType,
                ownerId: input.ownerId,
                assetId: input.assetId,
                provider,
                providerTransferId,
                required,
                status,
                counterpartyVasp: input.counterpartyVasp || null,
                checkedAt,
                latestRawPayload: rawPayload,
                latestNormalizedPayload: normalizedPayload,
            },
        });
        const report = await client.travelRuleCaseReport.create({
            data: {
                travelRuleCaseId: record.id,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                provider,
                providerTransferId,
                required,
                status,
                counterpartyVasp: input.counterpartyVasp || null,
                rawPayload,
                normalizedPayload,
                receivedAt: checkedAt,
            },
        });
        return { case: record, report };
    }
    async syncDepositSnapshotFromCases(depositId, tx) {
        const client = this.getClient(tx);
        const [kytCase, travelCase] = await Promise.all([
            client.kytCase.findUnique({
                where: {
                    sourceType_sourceId_screeningStage: {
                        sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                        sourceId: depositId,
                        screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
                    },
                },
            }),
            client.travelRuleCase.findUnique({
                where: {
                    sourceType_sourceId: {
                        sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                        sourceId: depositId,
                    },
                },
            }),
        ]);
        if (!kytCase && !travelCase) {
            return null;
        }
        const data = {};
        if (kytCase) {
            data.kytStatus = this.normalizeKytStatus(kytCase.status);
            data.kytScreeningId = kytCase.providerCaseId || kytCase.id;
            data.kytRiskScore = kytCase.riskScore;
            data.kytCheckedAt = kytCase.checkedAt;
        }
        if (travelCase) {
            data.travelRuleRequired = travelCase.required;
            data.travelRuleStatus = this.normalizeTravelRuleStatus(travelCase.status, travelCase.required);
            data.travelRuleTransferId =
                travelCase.providerTransferId || travelCase.id;
            data.counterpartyVasp = travelCase.counterpartyVasp;
            data.travelRuleCheckedAt = travelCase.checkedAt;
        }
        return client.depositTransaction.update({
            where: { id: depositId },
            data,
        });
    }
    async syncWithdrawSnapshotFromCases(withdrawId, tx) {
        const client = this.getClient(tx);
        const [preKytCase, mainKytCase, travelCase] = await Promise.all([
            client.kytCase.findUnique({
                where: {
                    sourceType_sourceId_screeningStage: {
                        sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                        sourceId: withdrawId,
                        screeningStage: tx_compliance_types_1.KytScreeningStage.PRE_TXN,
                    },
                },
            }),
            client.kytCase.findUnique({
                where: {
                    sourceType_sourceId_screeningStage: {
                        sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                        sourceId: withdrawId,
                        screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
                    },
                },
            }),
            client.travelRuleCase.findUnique({
                where: {
                    sourceType_sourceId: {
                        sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                        sourceId: withdrawId,
                    },
                },
            }),
        ]);
        if (!preKytCase && !mainKytCase && !travelCase) {
            return null;
        }
        const preStatus = this.normalizeKytStatus(preKytCase?.status);
        const mainStatus = this.normalizeKytStatus(mainKytCase?.status);
        const travelRequired = travelCase?.required ?? false;
        const travelStatus = this.normalizeTravelRuleStatus(travelCase?.status, travelRequired);
        const complianceStatus = this.deriveWithdrawComplianceStatus({
            preKytStatus: preStatus,
            mainKytStatus: mainStatus,
            travelRuleStatus: travelStatus,
            travelRuleRequired: travelRequired,
            hasPre: !!preKytCase,
            hasMain: !!mainKytCase,
            hasTravel: !!travelCase,
        });
        const data = {
            preKytStatus: preStatus,
            kytStatus: mainStatus,
            travelRuleRequired: travelRequired,
            travelRuleStatus: travelStatus,
            complianceStatus,
            complianceReviewedAt: complianceStatus === 'PENDING' ? null : new Date(),
        };
        if (preKytCase) {
            data.preKytId = preKytCase.providerCaseId || preKytCase.id;
            data.preKytRiskScore = preKytCase.riskScore;
            data.preKytCheckedAt = preKytCase.checkedAt;
        }
        if (mainKytCase) {
            data.kytScreeningId = mainKytCase.providerCaseId || mainKytCase.id;
            data.kytRiskScore = mainKytCase.riskScore;
            data.kytCheckedAt = mainKytCase.checkedAt;
        }
        if (travelCase) {
            data.travelRuleTransferId =
                travelCase.providerTransferId || travelCase.id;
            data.travelRuleCheckedAt = travelCase.checkedAt;
            data.counterpartyVasp = travelCase.counterpartyVasp;
        }
        return client.withdrawTransaction.update({
            where: { id: withdrawId },
            data,
        });
    }
    async ensureDepositComplianceCases(depositId, tx) {
        const client = this.getClient(tx);
        const deposit = await client.depositTransaction.findUnique({
            where: { id: depositId },
            select: {
                id: true,
                ownerType: true,
                ownerId: true,
                assetId: true,
                travelRuleRequired: true,
            },
        });
        if (!deposit) {
            throw new common_1.NotFoundException(`Deposit ${depositId} not found`);
        }
        const providerMode = this.getProviderMode();
        const provider = providerMode === 'MOCK' ? 'MOCK' : 'MANUAL';
        if (providerMode === 'MOCK') {
            const providerCaseId = `MOCK-KYT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const providerTransferId = `MOCK-TRV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const riskScore = Math.floor(Math.random() * 30) + 1;
            const checkedAt = new Date();
            await this.upsertKytCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                sourceId: deposit.id,
                screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
                ownerType: deposit.ownerType,
                ownerId: deposit.ownerId,
                assetId: deposit.assetId,
                provider,
                providerCaseId,
                status: 'PASS',
                riskScore,
                checkedAt,
                rawPayload: this.buildMockKytPayload({
                    sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                    sourceId: deposit.id,
                    stage: tx_compliance_types_1.KytScreeningStage.MAIN,
                    status: 'PASS',
                    riskScore,
                    providerCaseId,
                }),
                normalizedPayload: {
                    status: 'PASS',
                    riskScore,
                },
            }, tx);
            const travelStatus = deposit.travelRuleRequired ? 'ACCEPTED' : 'NOT_REQUIRED';
            await this.upsertTravelRuleCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                sourceId: deposit.id,
                ownerType: deposit.ownerType,
                ownerId: deposit.ownerId,
                assetId: deposit.assetId,
                provider,
                providerTransferId,
                required: deposit.travelRuleRequired,
                status: travelStatus,
                checkedAt,
                rawPayload: this.buildMockTravelPayload({
                    sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                    sourceId: deposit.id,
                    status: travelStatus,
                    required: deposit.travelRuleRequired,
                    providerTransferId,
                }),
                normalizedPayload: {
                    required: deposit.travelRuleRequired,
                    status: travelStatus,
                },
            }, tx);
        }
        else {
            await this.upsertKytCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                sourceId: deposit.id,
                screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
                ownerType: deposit.ownerType,
                ownerId: deposit.ownerId,
                assetId: deposit.assetId,
                provider,
                status: 'PENDING',
                rawPayload: {
                    status: 'PENDING',
                    source: 'manual-placeholder',
                },
                normalizedPayload: {
                    status: 'PENDING',
                },
            }, tx);
            await this.upsertTravelRuleCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                sourceId: deposit.id,
                ownerType: deposit.ownerType,
                ownerId: deposit.ownerId,
                assetId: deposit.assetId,
                provider,
                required: deposit.travelRuleRequired,
                status: deposit.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
                rawPayload: {
                    status: deposit.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
                    source: 'manual-placeholder',
                },
                normalizedPayload: {
                    required: deposit.travelRuleRequired,
                    status: deposit.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
                },
            }, tx);
        }
        return this.syncDepositSnapshotFromCases(deposit.id, tx);
    }
    async ensureWithdrawComplianceCases(withdrawId, tx) {
        const client = this.getClient(tx);
        const withdrawal = await client.withdrawTransaction.findUnique({
            where: { id: withdrawId },
            select: {
                id: true,
                ownerType: true,
                ownerId: true,
                assetId: true,
                travelRuleRequired: true,
            },
        });
        if (!withdrawal) {
            throw new common_1.NotFoundException(`Withdraw ${withdrawId} not found`);
        }
        const providerMode = this.getProviderMode();
        const provider = providerMode === 'MOCK' ? 'MOCK' : 'MANUAL';
        if (providerMode === 'MOCK') {
            const checkedAt = new Date();
            const preRisk = Math.floor(Math.random() * 20) + 1;
            const mainRisk = Math.floor(Math.random() * 30) + 1;
            const preProviderCaseId = `MOCK-KYT-PRE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const mainProviderCaseId = `MOCK-KYT-MAIN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const providerTransferId = `MOCK-TRV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            await this.upsertKytCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                sourceId: withdrawal.id,
                screeningStage: tx_compliance_types_1.KytScreeningStage.PRE_TXN,
                ownerType: withdrawal.ownerType,
                ownerId: withdrawal.ownerId,
                assetId: withdrawal.assetId,
                provider,
                providerCaseId: preProviderCaseId,
                status: 'PASS',
                riskScore: preRisk,
                checkedAt,
                rawPayload: this.buildMockKytPayload({
                    sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                    sourceId: withdrawal.id,
                    stage: tx_compliance_types_1.KytScreeningStage.PRE_TXN,
                    status: 'PASS',
                    riskScore: preRisk,
                    providerCaseId: preProviderCaseId,
                }),
                normalizedPayload: {
                    status: 'PASS',
                    riskScore: preRisk,
                },
            }, tx);
            await this.upsertKytCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                sourceId: withdrawal.id,
                screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
                ownerType: withdrawal.ownerType,
                ownerId: withdrawal.ownerId,
                assetId: withdrawal.assetId,
                provider,
                providerCaseId: mainProviderCaseId,
                status: 'PASS',
                riskScore: mainRisk,
                checkedAt,
                rawPayload: this.buildMockKytPayload({
                    sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                    sourceId: withdrawal.id,
                    stage: tx_compliance_types_1.KytScreeningStage.MAIN,
                    status: 'PASS',
                    riskScore: mainRisk,
                    providerCaseId: mainProviderCaseId,
                }),
                normalizedPayload: {
                    status: 'PASS',
                    riskScore: mainRisk,
                },
            }, tx);
            const travelStatus = withdrawal.travelRuleRequired ? 'ACCEPTED' : 'NOT_REQUIRED';
            await this.upsertTravelRuleCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                sourceId: withdrawal.id,
                ownerType: withdrawal.ownerType,
                ownerId: withdrawal.ownerId,
                assetId: withdrawal.assetId,
                provider,
                providerTransferId,
                required: withdrawal.travelRuleRequired,
                status: travelStatus,
                checkedAt,
                rawPayload: this.buildMockTravelPayload({
                    sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                    sourceId: withdrawal.id,
                    status: travelStatus,
                    required: withdrawal.travelRuleRequired,
                    providerTransferId,
                }),
                normalizedPayload: {
                    required: withdrawal.travelRuleRequired,
                    status: travelStatus,
                },
            }, tx);
        }
        else {
            await this.upsertKytCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                sourceId: withdrawal.id,
                screeningStage: tx_compliance_types_1.KytScreeningStage.PRE_TXN,
                ownerType: withdrawal.ownerType,
                ownerId: withdrawal.ownerId,
                assetId: withdrawal.assetId,
                provider,
                status: 'PENDING',
                rawPayload: { status: 'PENDING', stage: tx_compliance_types_1.KytScreeningStage.PRE_TXN },
                normalizedPayload: { status: 'PENDING' },
            }, tx);
            await this.upsertKytCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                sourceId: withdrawal.id,
                screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
                ownerType: withdrawal.ownerType,
                ownerId: withdrawal.ownerId,
                assetId: withdrawal.assetId,
                provider,
                status: 'PENDING',
                rawPayload: { status: 'PENDING', stage: tx_compliance_types_1.KytScreeningStage.MAIN },
                normalizedPayload: { status: 'PENDING' },
            }, tx);
            await this.upsertTravelRuleCaseAndAppendReport({
                sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
                sourceId: withdrawal.id,
                ownerType: withdrawal.ownerType,
                ownerId: withdrawal.ownerId,
                assetId: withdrawal.assetId,
                provider,
                required: withdrawal.travelRuleRequired,
                status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
                rawPayload: {
                    status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
                },
                normalizedPayload: {
                    required: withdrawal.travelRuleRequired,
                    status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
                },
            }, tx);
        }
        return this.syncWithdrawSnapshotFromCases(withdrawal.id, tx);
    }
    async mockCompleteKytCase(dto, tx) {
        const sourceContext = this.resolveManualSourceContext(dto) ||
            (await this.resolveSourceContext(dto.sourceType, dto.sourceId, tx));
        const stage = dto.screeningStage ?? tx_compliance_types_1.KytScreeningStage.MAIN;
        const provider = dto.provider || 'MOCK';
        const providerCaseId = dto.providerCaseId || `MOCK-KYT-${Date.now()}`;
        const status = this.normalizeKytStatus(dto.status || 'PASS');
        const riskScore = dto.riskScore ?? Math.floor(Math.random() * 30) + 1;
        const checkedAt = new Date();
        const upserted = await this.upsertKytCaseAndAppendReport({
            ...sourceContext,
            screeningStage: stage,
            provider,
            providerCaseId,
            status,
            riskScore,
            checkedAt,
            rawPayload: dto.rawPayload ||
                this.buildMockKytPayload({
                    sourceType: dto.sourceType,
                    sourceId: dto.sourceId,
                    stage,
                    status,
                    riskScore,
                    providerCaseId,
                }),
            normalizedPayload: dto.normalizedPayload || {
                status,
                riskScore,
            },
        }, tx);
        if (dto.sourceType === tx_compliance_types_1.TxSourceType.DEPOSIT) {
            await this.syncDepositSnapshotFromCases(dto.sourceId, tx);
        }
        if (dto.sourceType === tx_compliance_types_1.TxSourceType.WITHDRAW) {
            await this.syncWithdrawSnapshotFromCases(dto.sourceId, tx);
        }
        return upserted;
    }
    async mockCompleteTravelRuleCase(dto, tx) {
        const sourceContext = this.resolveManualSourceContext(dto) ||
            (await this.resolveSourceContext(dto.sourceType, dto.sourceId, tx));
        const provider = dto.provider || 'MOCK';
        const required = dto.required ?? false;
        const status = this.normalizeTravelRuleStatus(dto.status || (required ? 'ACCEPTED' : 'NOT_REQUIRED'), required);
        const providerTransferId = dto.providerTransferId || `MOCK-TRV-${Date.now()}`;
        const checkedAt = new Date();
        const upserted = await this.upsertTravelRuleCaseAndAppendReport({
            ...sourceContext,
            provider,
            providerTransferId,
            required,
            status,
            counterpartyVasp: dto.counterpartyVasp || null,
            checkedAt,
            rawPayload: dto.rawPayload ||
                this.buildMockTravelPayload({
                    sourceType: dto.sourceType,
                    sourceId: dto.sourceId,
                    status,
                    required,
                    providerTransferId,
                    counterpartyVasp: dto.counterpartyVasp,
                }),
            normalizedPayload: dto.normalizedPayload || {
                required,
                status,
                counterpartyVasp: dto.counterpartyVasp || null,
            },
        }, tx);
        if (dto.sourceType === tx_compliance_types_1.TxSourceType.DEPOSIT) {
            await this.syncDepositSnapshotFromCases(dto.sourceId, tx);
        }
        if (dto.sourceType === tx_compliance_types_1.TxSourceType.WITHDRAW) {
            await this.syncWithdrawSnapshotFromCases(dto.sourceId, tx);
        }
        return upserted;
    }
    async mockBackfill(dto) {
        const providerMode = this.getProviderMode();
        const limit = dto.limit ?? 100;
        const dryRun = dto.dryRun ?? false;
        const sourceTypes = dto.sourceType
            ? [dto.sourceType]
            : [tx_compliance_types_1.TxSourceType.DEPOSIT, tx_compliance_types_1.TxSourceType.WITHDRAW];
        let scanned = 0;
        let processed = 0;
        const summary = {
            deposit: { scanned: 0, processed: 0 },
            withdraw: { scanned: 0, processed: 0 },
        };
        if (sourceTypes.includes(tx_compliance_types_1.TxSourceType.DEPOSIT)) {
            const where = {};
            if (dto.sourceStatus) {
                where.status = dto.sourceStatus;
            }
            else {
                where.status = {
                    in: [
                        deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING,
                        deposit_transaction_dto_1.DepositTransactionStatus.UNDER_REVIEW,
                    ],
                };
            }
            const rows = await this.prisma.depositTransaction.findMany({
                where,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: { id: true },
            });
            summary.deposit.scanned = rows.length;
            scanned += rows.length;
            if (!dryRun) {
                for (const row of rows) {
                    await this.ensureDepositComplianceCases(row.id);
                    summary.deposit.processed += 1;
                    processed += 1;
                }
            }
        }
        if (sourceTypes.includes(tx_compliance_types_1.TxSourceType.WITHDRAW)) {
            const where = {};
            if (dto.sourceStatus) {
                where.status = dto.sourceStatus;
            }
            else {
                where.status = {
                    in: [
                        withdraw_transaction_dto_1.WithdrawTransactionStatus.PENDING_COMPLIANCE,
                        withdraw_transaction_dto_1.WithdrawTransactionStatus.UNDER_REVIEW,
                    ],
                };
            }
            const rows = await this.prisma.withdrawTransaction.findMany({
                where,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: { id: true },
            });
            summary.withdraw.scanned = rows.length;
            scanned += rows.length;
            if (!dryRun) {
                for (const row of rows) {
                    await this.ensureWithdrawComplianceCases(row.id);
                    summary.withdraw.processed += 1;
                    processed += 1;
                }
            }
        }
        this.logger.log(`tx compliance mock-backfill finished: mode=${providerMode}, dryRun=${dryRun}, scanned=${scanned}, processed=${processed}`);
        return {
            mode: providerMode,
            dryRun,
            scanned,
            processed,
            summary,
        };
    }
    async getCaseSummaries(sourceType, sourceId, screeningStage = tx_compliance_types_1.KytScreeningStage.MAIN, tx) {
        const client = this.getClient(tx);
        const [kytCase, travelRuleCase] = await Promise.all([
            client.kytCase.findUnique({
                where: {
                    sourceType_sourceId_screeningStage: {
                        sourceType,
                        sourceId,
                        screeningStage,
                    },
                },
                select: {
                    id: true,
                    caseNo: true,
                    sourceType: true,
                    sourceId: true,
                    screeningStage: true,
                    provider: true,
                    providerCaseId: true,
                    status: true,
                    riskScore: true,
                    checkedAt: true,
                    updatedAt: true,
                },
            }),
            client.travelRuleCase.findUnique({
                where: {
                    sourceType_sourceId: {
                        sourceType,
                        sourceId,
                    },
                },
                select: {
                    id: true,
                    caseNo: true,
                    sourceType: true,
                    sourceId: true,
                    provider: true,
                    providerTransferId: true,
                    required: true,
                    status: true,
                    counterpartyVasp: true,
                    checkedAt: true,
                    updatedAt: true,
                },
            }),
        ]);
        return {
            kytCase,
            travelRuleCase,
        };
    }
};
exports.TransactionComplianceService = TransactionComplianceService;
exports.TransactionComplianceService = TransactionComplianceService = TransactionComplianceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TransactionComplianceService);
//# sourceMappingURL=transaction-compliance.service.js.map