import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ChangeTicketsService } from '../src/modules/governance/change-tickets/change-tickets.service';
import { DeleteRequestsService } from '../src/modules/governance/delete-requests/delete-requests.service';
import { ApprovalActionTypes } from '../src/modules/governance/approvals/constants/approval.constants';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const prisma = app.get(PrismaService);
    const changeTicketsService = app.get(ChangeTicketsService);
    const deleteRequestsService = app.get(DeleteRequestsService);

    let repairedChangeTickets = 0;
    let repairedDeleteRequests = 0;

    const changeTickets = await prisma.changeTicket.findMany({
      where: {
        deletedAt: null,
        latestApprovalId: { not: null },
      },
      include: {
        latestApproval: {
          select: {
            id: true,
            approvalNo: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const ticket of changeTickets) {
      if (!ticket.latestApproval) {
        continue;
      }

      await changeTicketsService.syncApprovalProjectionByEvent({
        approvalId: ticket.latestApproval.id,
        approvalNo: ticket.latestApproval.approvalNo,
        entityRef: ticket.id,
        actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
        status: ticket.latestApproval.status,
      });
      repairedChangeTickets += 1;
    }

    const deleteRequests = await prisma.deleteRequest.findMany({
      where: {
        latestApprovalId: { not: null },
      },
      include: {
        latestApproval: {
          select: {
            id: true,
            approvalNo: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const request of deleteRequests) {
      if (!request.latestApproval) {
        continue;
      }

      await deleteRequestsService.syncApprovalProjectionByEvent({
        approvalId: request.latestApproval.id,
        approvalNo: request.latestApproval.approvalNo,
        entityRef: request.id,
        actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
        status: request.latestApproval.status,
      });
      repairedDeleteRequests += 1;
    }

    console.log(
      JSON.stringify(
        {
          repairedChangeTickets,
          repairedDeleteRequests,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
