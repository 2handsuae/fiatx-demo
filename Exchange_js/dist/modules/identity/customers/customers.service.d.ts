import { CustomerMain, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
export declare class CustomersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(data: Prisma.CustomerMainCreateInput): Promise<CustomerMain>;
    findAll(params: {
        skip?: number;
        take?: number;
        cursor?: Prisma.CustomerMainWhereUniqueInput;
        where?: Prisma.CustomerMainWhereInput;
        orderBy?: Prisma.CustomerMainOrderByWithRelationInput;
    }): Promise<{
        data: CustomerMain[];
        total: number;
    }>;
    findOne(id: string): Promise<any>;
    update(params: {
        where: Prisma.CustomerMainWhereUniqueInput;
        data: Prisma.CustomerMainUpdateInput;
    }): Promise<CustomerMain>;
    remove(where: Prisma.CustomerMainWhereUniqueInput): Promise<CustomerMain>;
    changeStatus(_id: string, _newStatus: string, _operatorId: string, _reason?: string): Promise<CustomerMain>;
}
