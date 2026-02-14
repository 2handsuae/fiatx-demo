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
exports.ClearingsController = void 0;
const common_1 = require("@nestjs/common");
const clearings_service_1 = require("./clearings.service");
const clearing_dto_1 = require("./dto/clearing.dto");
let ClearingsController = class ClearingsController {
    constructor(clearingsService) {
        this.clearingsService = clearingsService;
    }
    findAll(query) {
        return this.clearingsService.findAll(query);
    }
    findAllLines(query) {
        return this.clearingsService.findAllLines(query);
    }
    findLine(id) {
        return this.clearingsService.findLine(id);
    }
    findOne(id) {
        return this.clearingsService.findOne(id);
    }
    reClear(id) {
        return this.clearingsService.reClear(id);
    }
};
exports.ClearingsController = ClearingsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [clearing_dto_1.QueryClearingDto]),
    __metadata("design:returntype", void 0)
], ClearingsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('lines'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [clearing_dto_1.QueryClearingLineDto]),
    __metadata("design:returntype", void 0)
], ClearingsController.prototype, "findAllLines", null);
__decorate([
    (0, common_1.Get)('lines/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ClearingsController.prototype, "findLine", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ClearingsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(':id/re-clear'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ClearingsController.prototype, "reClear", null);
exports.ClearingsController = ClearingsController = __decorate([
    (0, common_1.Controller)('clearings'),
    __metadata("design:paramtypes", [clearings_service_1.ClearingsService])
], ClearingsController);
//# sourceMappingURL=clearings.controller.js.map