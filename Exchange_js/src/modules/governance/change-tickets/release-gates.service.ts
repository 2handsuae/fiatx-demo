import { Injectable } from '@nestjs/common';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { ChangeTicketsService } from './change-tickets.service';
import { GateCheckDto, MarkDeployStatusDto } from './dto/change-ticket.dto';

@Injectable()
export class ReleaseGatesService {
  constructor(private readonly changeTicketsService: ChangeTicketsService) {}

  listGateRuns(ticketId: string) {
    return this.changeTicketsService.listGateRuns(ticketId);
  }

  runGateCheck(ticketId: string, body: GateCheckDto, actor: ApprovalActorContext) {
    return this.changeTicketsService.runGateCheck(ticketId, body, actor);
  }

  markDeployStatus(
    ticketId: string,
    body: MarkDeployStatusDto,
    actor: ApprovalActorContext,
  ) {
    return this.changeTicketsService.markDeployStatus(ticketId, body, actor);
  }
}
