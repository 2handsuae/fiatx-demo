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
}
