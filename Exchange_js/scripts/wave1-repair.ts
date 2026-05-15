import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ChangeTicketsService } from '../src/modules/governance/change-tickets/change-tickets.service';
import { ApprovalActionTypes } from '../src/modules/governance/approvals/constants/approval.constants';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const prisma = app.get(PrismaService);
    const changeTicketsService = app.get(ChangeTicketsService);

    let repairedChangeTickets = 0;

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

    console.log(
      JSON.stringify(
        {
          repairedChangeTickets,
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
