import { LiquidityConfigService } from './liquidity-config.service';
import { CreateLiquidityConfigDto, UpdateLiquidityConfigDto, UpdateLiquidityConfigStatusDto } from './dto/liquidity-config.dto';
import { Prisma } from '@prisma/client';
export declare class LiquidityConfigController {
    private readonly service;
    constructor(service: LiquidityConfigService);
    create(dto: CreateLiquidityConfigDto): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        fromAssetId: string;
        toAssetId: string;
        lpId: string;
        rateSourceType: string;
        feePercent: Prisma.Decimal;
        feeFixedAmount: Prisma.Decimal;
        feeAssetId: string | null;
        minFromAmount: Prisma.Decimal | null;
        maxFromAmount: Prisma.Decimal | null;
    }>;
    findAll(skip?: string, take?: string, lpId?: string, status?: string): Promise<{
        items: ({
            fromAsset: {
                type: string;
                code: string;
            };
            toAsset: {
                type: string;
                code: string;
            };
            lp: {
                name: string;
            };
        } & {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            fromAssetId: string;
            toAssetId: string;
            lpId: string;
            rateSourceType: string;
            feePercent: Prisma.Decimal;
            feeFixedAmount: Prisma.Decimal;
            feeAssetId: string | null;
            minFromAmount: Prisma.Decimal | null;
            maxFromAmount: Prisma.Decimal | null;
        })[];
        total: number;
    }>;
    getAvailable(fromAssetId: string, toAssetId: string): Promise<({
        lp: {
            name: string;
            id: string;
            email: string | null;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            phone: string | null;
        };
    } & {
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        fromAssetId: string;
        toAssetId: string;
        lpId: string;
        rateSourceType: string;
        feePercent: Prisma.Decimal;
        feeFixedAmount: Prisma.Decimal;
        feeAssetId: string | null;
        minFromAmount: Prisma.Decimal | null;
        maxFromAmount: Prisma.Decimal | null;
    })[]>;
    getByLpId(lpId: string): Promise<({
        fromAsset: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            type: string;
            code: string;
            network: string | null;
            decimals: number;
            assetNo: string | null;
        };
        toAsset: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            type: string;
            code: string;
            network: string | null;
            decimals: number;
            assetNo: string | null;
        };
    } & {
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        fromAssetId: string;
        toAssetId: string;
        lpId: string;
        rateSourceType: string;
        feePercent: Prisma.Decimal;
        feeFixedAmount: Prisma.Decimal;
        feeAssetId: string | null;
        minFromAmount: Prisma.Decimal | null;
        maxFromAmount: Prisma.Decimal | null;
    })[]>;
    findOne(id: string): Promise<{
        fromAsset: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            type: string;
            code: string;
            network: string | null;
            decimals: number;
            assetNo: string | null;
        };
        toAsset: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            type: string;
            code: string;
            network: string | null;
            decimals: number;
            assetNo: string | null;
        };
        lp: {
            name: string;
            id: string;
            email: string | null;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            phone: string | null;
        };
        feeAsset: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            type: string;
            code: string;
            network: string | null;
            decimals: number;
            assetNo: string | null;
        } | null;
    } & {
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        fromAssetId: string;
        toAssetId: string;
        lpId: string;
        rateSourceType: string;
        feePercent: Prisma.Decimal;
        feeFixedAmount: Prisma.Decimal;
        feeAssetId: string | null;
        minFromAmount: Prisma.Decimal | null;
        maxFromAmount: Prisma.Decimal | null;
    }>;
    update(id: string, dto: UpdateLiquidityConfigDto): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        fromAssetId: string;
        toAssetId: string;
        lpId: string;
        rateSourceType: string;
        feePercent: Prisma.Decimal;
        feeFixedAmount: Prisma.Decimal;
        feeAssetId: string | null;
        minFromAmount: Prisma.Decimal | null;
        maxFromAmount: Prisma.Decimal | null;
    }>;
    remove(id: string): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        fromAssetId: string;
        toAssetId: string;
        lpId: string;
        rateSourceType: string;
        feePercent: Prisma.Decimal;
        feeFixedAmount: Prisma.Decimal;
        feeAssetId: string | null;
        minFromAmount: Prisma.Decimal | null;
        maxFromAmount: Prisma.Decimal | null;
    }>;
    changeStatus(id: string, dto: UpdateLiquidityConfigStatusDto): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        fromAssetId: string;
        toAssetId: string;
        lpId: string;
        rateSourceType: string;
        feePercent: Prisma.Decimal;
        feeFixedAmount: Prisma.Decimal;
        feeAssetId: string | null;
        minFromAmount: Prisma.Decimal | null;
        maxFromAmount: Prisma.Decimal | null;
    }>;
}
