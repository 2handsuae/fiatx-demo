import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

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

  constructor(private readonly jwtService: JwtService) {}

  // 铁律②门不可绕：入房必验签。握手带 auth.token（同源 JWT_SECRET），缺token/验签失败/
  // 非 CUSTOMER 一律 disconnect，不做重试或降级兜底。
  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secretKey',
      });
    } catch {
      client.disconnect(true);
      return;
    }

    if (payload?.type !== 'CUSTOMER') {
      client.disconnect(true);
      return;
    }

    client.join(`customer_${payload.sub}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  emitCustomerUpdated(customerId: string) {
    this.server.to(`customer_${customerId}`).emit('customer.updated', {});
  }
}
