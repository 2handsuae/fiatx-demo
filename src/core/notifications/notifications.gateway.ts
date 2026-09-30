import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    // In a real app, we would verify the token here and join a room
    // For now, clients can join rooms based on their customer ID manually
    const customerId = client.handshake.query.customerId as string;
    if (customerId) {
      client.join(`customer_${customerId}`);
      console.log(
        `Client connected: ${client.id} joined customer_${customerId}`,
      );
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  notifyComplianceUpdated(customerId: string, payload: Record<string, any>) {
    this.server.to(`customer_${customerId}`).emit('compliance_updated', {
      ...payload,
      timestamp: new Date(),
    });
  }

  // 战役丙波一 T2：控制器裁定的最小加法——本任务只加这一个方法，gateway 整体改写留给下一任务。
  emitCustomerUpdated(customerId: string) {
    this.server.to(`customer_${customerId}`).emit('customer.updated', {});
  }
}
