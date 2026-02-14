import { PrismaService } from '../../../core/prisma/prisma.service';
import { PayinQueryDto, PayinAction, SimulatePayinDto } from './dto/payin.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class PayinsService {
    private prisma;
    private eventEmitter;
    private readonly logger;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2);
    simulate(dto: SimulatePayinDto): Promise<any>;
    findAll(query: PayinQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    updateStatus(id: string, action: PayinAction): Promise<any>;
    linkDeposit(id: string, depositId: string): Promise<any>;
}
