import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PushService } from '../push/push.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGIN?.split(',') ?? true,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private logger = new Logger('RealtimeGateway');

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private pushService: PushService,
  ) {}

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ||
      (client.handshake.query?.token as string | undefined);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const secret = this.config.get<string>('JWT_ACCESS_SECRET') || 'dev-access-secret';
      const payload = this.jwt.verify(token, { secret });
      (client.data as Record<string, unknown>).user = payload;
      client.join(`user:${payload.userId}`);
      if (payload.roleName === 'super_admin') client.join('role:super_admin');
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // no per-connection state to clean up
  }

  // Never let a live-tab socket event that fails (server not ready, bad room, etc.)
  // stop the push notification that follows it -- the two must be independent.
  private emitSafely(fn: () => void) {
    try {
      fn();
    } catch (err: any) {
      this.logger.error(`Socket emit failed (push notification still proceeds): ${err.message}`);
    }
  }

  // A customer tapped "Request a call back" on a WhatsApp itinerary message.
  broadcastCallbackRequest(request: { id: string | null; customer_name: string; phone: string; assigned_to: string | null }) {
    this.emitSafely(() => this.server.emit('callback_requested', request));
    this.pushService
      .notifyAll({
        title: `Call back requested — ${request.customer_name}`,
        body: request.phone ? `Please call ${request.phone}` : 'Customer asked for a call back',
        url: request.id ? `/leads/${request.id}` : '/leads',
      })
      .then(() => this.logger.log(`Push sent: call back requested — ${request.customer_name}`))
      .catch((err) => this.logger.error(`Push notify failed: ${err.message}`));
  }

  // A customer wrote in on WhatsApp: refresh open inboxes and alert the agent.
  broadcastWhatsAppMessage(message: { lead_id: string | null; customer_name: string; phone: string; body: string; assigned_to: string | null }) {
    this.emitSafely(() => {
      if (message.assigned_to) this.server.to(`user:${message.assigned_to}`).to('role:super_admin').emit('whatsapp_message', message);
      else this.server.to('role:super_admin').emit('whatsapp_message', message);
    });
    this.pushService
      .notifyUsers(message.assigned_to ? [message.assigned_to] : [], {
        title: `WhatsApp — ${message.customer_name}`,
        body: message.body.slice(0, 120),
        url: '/whatsapp',
      })
      .then(() => this.logger.log(`Push sent: WhatsApp message — ${message.customer_name}`))
      .catch((err) => this.logger.error(`Push notify failed: ${err.message}`));
  }

  // An itinerary went out automatically to a real lead (not a test send).
  broadcastItinerarySent(info: { lead_id: string; customer_name: string; phone: string | null; package_name: string; assigned_to: string | null }) {
    this.emitSafely(() => {
      if (info.assigned_to) this.server.to(`user:${info.assigned_to}`).to('role:super_admin').emit('itinerary_sent', info);
      else this.server.to('role:super_admin').emit('itinerary_sent', info);
    });
    this.pushService
      .notifyUsers(info.assigned_to ? [info.assigned_to] : [], {
        title: `Itinerary sent — ${info.customer_name}`,
        body: `${info.package_name} was sent automatically on WhatsApp`,
        url: `/leads/${info.lead_id}`,
      })
      .then(() => this.logger.log(`Push sent: itinerary sent — ${info.customer_name}`))
      .catch((err) => this.logger.error(`Push notify failed: ${err.message}`));
  }

  // An itinerary (automatic or a manual resend) failed to go out. Broadcast to
  // everyone -- not just the assigned agent -- since a silent failure here is
  // exactly the thing that must never just sit unnoticed.
  broadcastItineraryFailed(info: { lead_id: string | null; customer_name: string; destination: string | null; reason: string | null }) {
    this.emitSafely(() => this.server.emit('itinerary_failed', info));
  }

  broadcastNewLead(lead: Record<string, unknown>) {
    const assignedTo = lead.assigned_to as string | undefined;
    this.emitSafely(() => {
      if (assignedTo) this.server.to(`user:${assignedTo}`).to('role:super_admin').emit('new_lead', lead);
      else this.server.to('role:super_admin').emit('new_lead', lead);
    });

    // Also push a real OS-level notification -- the socket event above only
    // reaches an open, focused CRM tab; this reaches a closed browser too.
    const name = (lead.customer_name as string) || 'New lead';
    const source = (lead.source as string) || '';
    this.pushService
      .notifyUsers(assignedTo ? [assignedTo] : [], {
        title: `New lead — ${name}`,
        body: source === 'social_media' || source === 'meta_ads' ? 'Facebook Lead Ad' : source || 'New source',
        url: `/leads/${lead.id}`,
      })
      .then(() => this.logger.log(`Push sent: new lead — ${name}`))
      .catch((err) => this.logger.error(`Push notify failed: ${err.message}`));
  }
}
