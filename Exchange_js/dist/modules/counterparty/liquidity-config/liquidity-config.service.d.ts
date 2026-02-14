import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateLiquidityConfigDto, UpdateLiquidityConfigDto, LiquidityConfigStatus } from './dto/liquidity-config.dto';
import { Prisma } from '@prisma/client';
export declare class LiquidityConfigService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    create(data: CreateLiquidityConfigDto): Promise<{
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
    findAll(params: {
        skip?: number;
        take?: number;
        where?: Prisma.LiquidityConfigurationWhereInput;
        orderBy?: Prisma.LiquidityConfigurationOrderByWithRelationInput;
    }): Promise<{
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
    update(id: string, data: UpdateLiquidityConfigDto): Promise<{
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
    changeStatus(id: string, status: LiquidityConfigStatus): Promise<{
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
    getAvailableConfigs(fromAssetId: string, toAssetId: string): Promise<({
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
}
