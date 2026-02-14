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
exports.WalletsController = void 0;
const common_1 = require("@nestjs/common");
const wallets_service_1 = require("./wallets.service");
const wallet_dto_1 = require("./dto/wallet.dto");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
let WalletsController = class WalletsController {
    constructor(service) {
        this.service = service;
    }
    ensureSupportedToken(req) {
        if (req.user?.type !== 'ADMIN' && req.user?.type !== 'CUSTOMER') {
            throw new common_1.ForbiddenException('Invalid token type');
        }
    }
    ensureAdmin(req) {
        if (req.user?.type !== 'ADMIN') {
            throw new common_1.ForbiddenException('Admin token required');
        }
    }
    create(req, dto) {
        this.ensureSupportedToken(req);
        if (req.user.type === 'CUSTOMER') {
            if (dto.ownerType !== wallet_dto_1.OwnerType.CUSTOMER || dto.ownerId !== req.user.userId) {
                throw new common_1.ForbiddenException('Customer can only create CUSTOMER wallets for self');
            }
        }
        return this.service.create(dto);
    }
    findAll(req, skip, take, ownerType, ownerId, type, assetId, status, direction) {
        this.ensureSupportedToken(req);
        const where = {};
        if (req.user.type === 'CUSTOMER') {
            if (ownerType && ownerType !== wallet_dto_1.OwnerType.CUSTOMER) {
                throw new common_1.ForbiddenException('Customer can only query CUSTOMER wallets');
            }
            if (ownerId && ownerId !== req.user.userId) {
                throw new common_1.ForbiddenException('Customer can only query own wallets');
            }
            where.ownerType = wallet_dto_1.OwnerType.CUSTOMER;
            where.ownerId = req.user.userId;
        }
        else {
            if (ownerType)
                where.ownerType = ownerType;
            if (ownerId)
                where.ownerId = ownerId;
        }
        if (type)
            where.type = type;
        if (assetId)
            where.assetId = assetId;
        if (status)
            where.status = status;
        if (direction)
            where.direction = direction;
        return this.service.findAll({
            skip: skip ? Number(skip) : 0,
            take: take ? Number(take) : 20,
            where,
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(req, id) {
        this.ensureSupportedToken(req);
        const wallet = await this.service.findOne(id);
        if (req.user.type === 'CUSTOMER' &&
            (wallet.ownerType !== wallet_dto_1.OwnerType.CUSTOMER || wallet.ownerId !== req.user.userId)) {
            throw new common_1.ForbiddenException('Customer can only access own wallets');
        }
        return wallet;
    }
    changeStatus(req, id, dto) {
        this.ensureAdmin(req);
        return this.service.changeStatus(id, dto.status);
    }
};
exports.WalletsController = WalletsController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new wallet' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, wallet_dto_1.CreateWalletDto]),
    __metadata("design:returntype", void 0)
], WalletsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all wallets' }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'ownerType', required: false, enum: wallet_dto_1.OwnerType }),
    (0, swagger_1.ApiQuery)({ name: 'ownerId', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'type', required: false, enum: wallet_dto_1.WalletType }),
    (0, swagger_1.ApiQuery)({ name: 'assetId', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, enum: wallet_dto_1.WalletStatus }),
    (0, swagger_1.ApiQuery)({ name: 'direction', required: false, enum: wallet_dto_1.WalletDirection }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('skip')),
    __param(2, (0, common_1.Query)('take')),
    __param(3, (0, common_1.Query)('ownerType')),
    __param(4, (0, common_1.Query)('ownerId')),
    __param(5, (0, common_1.Query)('type')),
    __param(6, (0, common_1.Query)('assetId')),
    __param(7, (0, common_1.Query)('status')),
    __param(8, (0, common_1.Query)('direction')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], WalletsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a wallet by ID' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], WalletsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, swagger_1.ApiOperation)({ summary: 'Change wallet status' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, wallet_dto_1.UpdateWalletStatusDto]),
    __metadata("design:returntype", void 0)
], WalletsController.prototype, "changeStatus", null);
exports.WalletsController = WalletsController = __decorate([
    (0, swagger_1.ApiTags)('wallets'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('wallets'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __metadata("design:paramtypes", [wallets_service_1.WalletsService])
], WalletsController);
//# sourceMappingURL=wallets.controller.js.map