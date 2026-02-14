import { ClearingsService } from './clearings.service';
import { QueryClearingDto, QueryClearingLineDto } from './dto/clearing.dto';
export declare class ClearingsController {
    private readonly clearingsService;
    constructor(clearingsService: ClearingsService);
    findAll(query: QueryClearingDto): Promise<{
        items: any[];
        total: any;
    }>;
    findAllLines(query: QueryClearingLineDto): Promise<{
        items: any[];
        total: any;
    }>;
    findLine(id: string): Promise<any>;
    findOne(id: string): Promise<any>;
    reClear(id: string): Promise<any>;
}
