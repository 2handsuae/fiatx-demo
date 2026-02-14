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
let AcctConfigService = AcctConfigService_1 = class AcctConfigService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(AcctConfigService_1.name);
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