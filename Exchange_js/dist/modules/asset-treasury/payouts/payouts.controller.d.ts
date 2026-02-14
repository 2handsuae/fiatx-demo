import { PayoutsService } from './payouts.service';
import { PayoutQueryDto, UpdatePayoutStatusDto, CreatePayoutDto } from './dto/payout.dto';
export declare class PayoutsController {
    private readonly service;
    constructor(service: PayoutsService);
    findAll(query: PayoutQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    create(req: any, dto: CreatePayoutDto): Promise<any>;
    createMock(req: any): Promise<any[]>;
    findOne(id: string): Promise<any>;
    updateStatus(req: any, id: string, dto: UpdatePayoutStatusDto): Promise<any>;
}
