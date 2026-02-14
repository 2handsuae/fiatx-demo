import { JournalsService } from './journals.service';
import { JournalQueryDto } from './dto/journal.dto';
export declare class JournalsController {
    private readonly journalsService;
    constructor(journalsService: JournalsService);
    findAll(query: JournalQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
}
