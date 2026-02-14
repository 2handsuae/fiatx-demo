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
exports.JournalsController = void 0;
const common_1 = require("@nestjs/common");
const journals_service_1 = require("./journals.service");
const journal_dto_1 = require("./dto/journal.dto");
const swagger_1 = require("@nestjs/swagger");
let JournalsController = class JournalsController {
    constructor(journalsService) {
        this.journalsService = journalsService;
    }
    findAll(query) {
        return this.journalsService.findAll(query);
    }
    findOne(id) {
        return this.journalsService.findOne(id);
    }
};
exports.JournalsController = JournalsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all journal entries' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [journal_dto_1.JournalQueryDto]),
    __metadata("design:returntype", void 0)
], JournalsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a journal entry by id' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], JournalsController.prototype, "findOne", null);
exports.JournalsController = JournalsController = __decorate([
    (0, swagger_1.ApiTags)('Journals'),
    (0, common_1.Controller)('journals'),
    __metadata("design:paramtypes", [journals_service_1.JournalsService])
], JournalsController);
//# sourceMappingURL=journals.controller.js.map