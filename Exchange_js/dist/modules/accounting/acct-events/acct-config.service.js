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
var AcctConfigService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcctConfigService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const events_manifest_1 = require("../../../config/manifests/events.manifest");
const journal_templates_manifest_1 = require("../../../config/manifests/journal-templates.manifest");
const DEPOSIT_REJECTED_EVENT_CODES = [
    'EVT_DEPOSIT_REJECTED__CRYPTO',
    'EVT_DEPOSIT_REJECTED__FIAT',
];
const DEPOSIT_EVENT_EXPECTED_TO_STATUS = {
    EVT_DEPOSIT_CONFIRMED__CRYPTO: 'COMPLIANCE_PENDING',
    EVT_DEPOSIT_CONFIRMED__FIAT: 'COMPLIANCE_PENDING',
    EVT_DEPOSIT_SUCCESS__CRYPTO: 'SUCCESS',
    EVT_DEPOSIT_SUCCESS__FIAT: 'SUCCESS',
};
let AcctConfigService = AcctConfigService_1 = class AcctConfigService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(AcctConfigService_1.name);
    }
    async onModuleInit() {
        const env = (process.env.NODE_ENV || 'development').toLowerCase();
        if (env === 'production') {
            const validation = await this.validateDepositEventContract();
            if (!validation.ok) {
                this.logger.warn(`Deposit accounting event contract mismatch detected (production check-only): ${validation.issues.join(' | ')}`);
            }
            else {
                this.logger.log('Deposit accounting event contract check passed (production mode).');
            }
            return;
        }
        try {
            await this.syncDefaults();
            const validation = await this.validateDepositEventContract();
            if (!validation.ok) {
                this.logger.warn(`Deposit accounting event contract mismatch detected after sync: ${validation.issues.join(' | ')}`);
            }
        }
        catch (error) {
            this.logger.error(`Failed to auto-sync accounting defaults on startup: ${error?.message || String(error)}`);
        }
    }
    async cleanupRejectedDepositEvents() {
        try {
            await this.prisma.journalHeaderTemplate.deleteMany({
                where: { eventCode: { in: [...DEPOSIT_REJECTED_EVENT_CODES] } },
            });
        }
        catch (error) {
            this.logger.warn(`Failed to delete rejected deposit templates, fallback to inactivate: ${error?.message || String(error)}`);
            await this.prisma.journalHeaderTemplate.updateMany({
                where: { eventCode: { in: [...DEPOSIT_REJECTED_EVENT_CODES] } },
                data: { status: 'INACTIVE' },
            });
        }
        try {
            await this.prisma.acctEvent.deleteMany({
                where: { eventCode: { in: [...DEPOSIT_REJECTED_EVENT_CODES] } },
            });
        }
        catch (error) {
            this.logger.warn(`Failed to delete rejected deposit events, fallback to deactivate: ${error?.message || String(error)}`);
            await this.prisma.acctEvent.updateMany({
                where: { eventCode: { in: [...DEPOSIT_REJECTED_EVENT_CODES] } },
                data: { isActive: false },
            });
        }
    }
    async validateDepositEventContract() {
        const issues = [];
        const expectedEventCodes = Object.keys(DEPOSIT_EVENT_EXPECTED_TO_STATUS);
        const rows = await this.prisma.acctEvent.findMany({
            where: {
                eventCode: {
                    in: [...expectedEventCodes, ...DEPOSIT_REJECTED_EVENT_CODES],
                },
            },
            select: {
                eventCode: true,
                triggerType: true,
                triggerKey: true,
                fromStatus: true,
                toStatus: true,
                isActive: true,
            },
        });
        const byCode = new Map(rows.map((row) => [row.eventCode, row]));
        for (const eventCode of expectedEventCodes) {
            const row = byCode.get(eventCode);
            if (!row) {
                issues.push(`${eventCode} missing`);
                continue;
            }
            if (!row.isActive) {
                issues.push(`${eventCode} inactive`);
            }
            if (row.triggerType !== 'STATUS_TRANSITION') {
                issues.push(`${eventCode} triggerType=${row.triggerType}`);
            }
            if (row.triggerKey !== 'status') {
                issues.push(`${eventCode} triggerKey=${row.triggerKey}`);
            }
            if (row.fromStatus !== null) {
                issues.push(`${eventCode} fromStatus expected NULL but got ${row.fromStatus}`);
            }
            if (row.toStatus !== DEPOSIT_EVENT_EXPECTED_TO_STATUS[eventCode]) {
                issues.push(`${eventCode} toStatus expected ${DEPOSIT_EVENT_EXPECTED_TO_STATUS[eventCode]} but got ${row.toStatus}`);
            }
        }
        for (const rejectedEventCode of DEPOSIT_REJECTED_EVENT_CODES) {
            if (byCode.has(rejectedEventCode)) {
                issues.push(`${rejectedEventCode} should be removed`);
            }
        }
        return { ok: issues.length === 0, issues };
    }
    async syncDefaults() {
        this.logger.log('Starting synchronization of default accounting configuration...');
        for (const event of events_manifest_1.DEFAULT_ACCT_EVENTS) {
            await this.prisma.acctEvent.upsert({
                where: { eventCode: event.eventCode },
                update: event,
                create: event,
            });
        }
        await this.cleanupRejectedDepositEvents();
        this.logger.log(`Synced ${events_manifest_1.DEFAULT_ACCT_EVENTS.length} accounting events.`);
        const baseAsset = await this.prisma.asset.findFirst({ where: { code: 'AED' } })
            || await this.prisma.asset.findFirst();
        if (!baseAsset) {
            this.logger.warn('No assets found. Skipping journal template synchronization.');
            return { success: true, message: 'Events synced, but no assets found for templates.' };
        }
        for (const tpl of journal_templates_manifest_1.DEFAULT_JOURNAL_TEMPLATES) {
            const headerData = {
                ...tpl.header,
                baseAssetId: baseAsset.id,
            };
            const header = await this.prisma.journalHeaderTemplate.upsert({
                where: { templateCode: tpl.header.templateCode },
                update: headerData,
                create: headerData,
            });
            await this.prisma.journalLineTemplate.deleteMany({
                where: { templateId: header.id },
            });
            for (const line of tpl.lines) {
                const coa = await this.prisma.coa.findUnique({ where: { code: line.accountCode } });
                if (!coa) {
                    this.logger.error(`COA ${line.accountCode} missing! Skipping line.`);
                    continue;
                }
                await this.prisma.journalLineTemplate.create({
                    data: {
                        ...line,
                        templateId: header.id,
                    },
                });
            }
        }
        this.logger.log(`Synced ${journal_templates_manifest_1.DEFAULT_JOURNAL_TEMPLATES.length} journal templates.`);
        return { success: true, message: 'Accounting configuration synchronized successfully.' };
    }
};
exports.AcctConfigService = AcctConfigService;
exports.AcctConfigService = AcctConfigService = AcctConfigService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AcctConfigService);
//# sourceMappingURL=acct-config.service.js.map