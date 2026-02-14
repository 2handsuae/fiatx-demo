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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcctEventsController = void 0;
const common_1 = require("@nestjs/common");
const acct_events_service_1 = require("./acct-events.service");
const acct_config_service_1 = require("./acct-config.service");
const acct_event_dto_1 = require("./dto/acct-event.dto");
const swagger_1 = require("@nestjs/swagger");
let AcctEventsController = class AcctEventsController {
    constructor(acctEventsService, acctConfigService) {
        this.acctEventsService = acctEventsService;
        this.acctConfigService = acctConfigService;
    }
    syncDefaults() {
        return this.acctConfigService.syncDefaults();
    }
    create(createDto) {
        return this.acctEventsService.create(createDto);
    }
    findAll(query) {
        return this.acctEventsService.findAll(query);
    }
    findOne(eventCode) {
        return this.acctEventsService.findOne(eventCode);
    }
    update(eventCode, updateDto) {
        return this.acctEventsService.update(eventCode, updateDto);
    }
    remove(eventCode) {
        return this.acctEventsService.remove(eventCode);
    }
};
exports.AcctEventsController = AcctEventsController;
__decorate([
    (0, common_1.Post)('sync-defaults'),
    (0, swagger_1.ApiOperation)({ summary: 'Sync default accounting events and templates' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AcctEventsController.prototype, "syncDefaults", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new accounting event' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [acct_event_dto_1.CreateAcctEventDto]),
    __metadata("design:returntype", void 0)
], AcctEventsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all accounting events' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [acct_event_dto_1.AcctEventQueryDto]),
    __metadata("design:returntype", void 0)
], AcctEventsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':eventCode'),
    (0, swagger_1.ApiOperation)({ summary: 'Get an accounting event by code' }),
    __param(0, (0, common_1.Param)('eventCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AcctEventsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':eventCode'),
    (0, swagger_1.ApiOperation)({ summary: 'Update an accounting event' }),
    __param(0, (0, common_1.Param)('eventCode')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, acct_event_dto_1.UpdateAcctEventDto]),
    __metadata("design:returntype", void 0)
], AcctEventsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':eventCode'),
    (0, swagger_1.ApiOperation)({ summary: 'Deactivate an accounting event' }),
    __param(0, (0, common_1.Param)('eventCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AcctEventsController.prototype, "remove", null);
exports.AcctEventsController = AcctEventsController = __decorate([
    (0, swagger_1.ApiTags)('Account Events'),
    (0, common_1.Controller)('acct-events'),
    __metadata("design:paramtypes", [acct_events_service_1.AcctEventsService,
        acct_config_service_1.AcctConfigService])
], AcctEventsController);
//# sourceMappingURL=acct-events.controller.js.map