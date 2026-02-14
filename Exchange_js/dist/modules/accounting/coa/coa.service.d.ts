import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateCoaDto, UpdateCoaDto, CoaQueryDto } from './dto/coa.dto';
export declare class CoaService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    create(createCoaDto: CreateCoaDto): Promise<{
        requiredTags: any;
        name: string;
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        code: string;
    }>;
    findAll(query: CoaQueryDto): Promise<{
        items: {
            requiredTags: any;
            name: string;
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            type: string;
            code: string;
        }[];
        total: number;
    }>;
    findOne(id: string): Promise<{
        requiredTags: any;
        name: string;
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        code: string;
    }>;
    update(id: string, updateCoaDto: UpdateCoaDto): Promise<{
        requiredTags: any;
        name: string;
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        code: string;
    }>;
    remove(id: string): Promise<{
        name: string;
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        code: string;
        requiredTags: string;
    }>;
}
