import { PayinsService } from './payins.service';
import { PayinQueryDto, UpdatePayinStatusDto, SimulatePayinDto } from './dto/payin.dto';
export declare class PayinsController {
    private readonly service;
    constructor(service: PayinsService);
    simulate(dto: SimulatePayinDto): Promise<any>;
    findAll(query: PayinQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    updateStatus(id: string, dto: UpdatePayinStatusDto): Promise<any>;
}
