import { WalletsService } from './wallets.service';
import { CreateWalletDto, UpdateWalletStatusDto } from './dto/wallet.dto';
import { Prisma } from '@prisma/client';
export declare class WalletsController {
    private readonly service;
    constructor(service: WalletsService);
    create(dto: CreateWalletDto): Promise<{
        asset: {
            type: string;
            code: string;
        };
    } & {
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        walletNo: string | null;
        ownerType: string;
        ownerNo: string | null;
        direction: string;
        balance: Prisma.Decimal;
        lockedBalance: Prisma.Decimal;
        address: string | null;
        memo: string | null;
        bankName: string | null;
        bankAccount: string | null;
        bankCode: string | null;
        accountName: string | null;
        beneficiaryName: string | null;
        counterpartyVasp: string | null;
        iban: string | null;
        assetId: string;
        ownerId: string | null;
    }>;
    findAll(skip?: string, take?: string, ownerType?: string, ownerId?: string, type?: string, assetId?: string, status?: string, direction?: string): Promise<{
        items: ({
            asset: {
                type: string;
                code: string;
            };
        } & {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            type: string;
            walletNo: string | null;
            ownerType: string;
            ownerNo: string | null;
            direction: string;
            balance: Prisma.Decimal;
            lockedBalance: Prisma.Decimal;
            address: string | null;
            memo: string | null;
            bankName: string | null;
            bankAccount: string | null;
            bankCode: string | null;
            accountName: string | null;
            beneficiaryName: string | null;
            counterpartyVasp: string | null;
            iban: string | null;
            assetId: string;
            ownerId: string | null;
        })[];
        total: number;
    }>;
    findOne(id: string): Promise<{
        ownerNo: any;
        asset: {
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
        customer: {
            customerNo: string;
        } | null;
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        walletNo: string | null;
        ownerType: string;
        direction: string;
        balance: Prisma.Decimal;
        lockedBalance: Prisma.Decimal;
        address: string | null;
        memo: string | null;
        bankName: string | null;
        bankAccount: string | null;
        bankCode: string | null;
        accountName: string | null;
        beneficiaryName: string | null;
        counterpartyVasp: string | null;
        iban: string | null;
        assetId: string;
        ownerId: string | null;
    }>;
    changeStatus(id: string, dto: UpdateWalletStatusDto): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        walletNo: string | null;
        ownerType: string;
        ownerNo: string | null;
        direction: string;
        balance: Prisma.Decimal;
        lockedBalance: Prisma.Decimal;
        address: string | null;
        memo: string | null;
        bankName: string | null;
        bankAccount: string | null;
        bankCode: string | null;
        accountName: string | null;
        beneficiaryName: string | null;
        counterpartyVasp: string | null;
        iban: string | null;
        assetId: string;
        ownerId: string | null;
    }>;
}
