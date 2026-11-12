import type { EventBus } from '../core/events';
import type { HostRequest, HostResponse, NetworkNode, SimClock } from '../core/types';
import type { FaultState } from '../faults/faultState';
import type { AuthorizationHost } from './host';

export interface NetworkConfig {
  hostHopLatencyMs: number;
  hostTimeoutMs: number;
}

export interface NetResult {
  response?: HostResponse;
  /** True when the ATM gave up waiting (no response within hostTimeoutMs). */
  timedOut: boolean;
  /** For training: the response that was produced by the host but lost on the way back. */
  lostResponse?: HostResponse;
}

/**
 * Conceptual message path: ATM → ATM controller → network switch → bank authorisation host → account
 * ledger, and back. Each hop takes `hostHopLatencyMs` of SIM time and emits a 'net.message' event so the
 * network dashboard can animate it.
 *
 * Training faults:
 *  - host-unavailable (latching): the SWITCH cannot reach the HOST and answers code 91 itself. The host never
 *    sees the request, so no hold can exist.
 *  - network-timeout (one-shot, WITHDRAWAL_AUTH only): the HOST processes the request (and places a hold!)
 *    but the response is lost between the switch and the controller. The ATM waits `hostTimeoutMs` and must
 *    assume the worst: it sends a REVERSAL so the hold it cannot see is released.
 */
export class Network {
  messagesSent = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly clock: SimClock,
    private readonly host: AuthorizationHost,
    private readonly faults: FaultState,
    private readonly config: () => NetworkConfig,
  ) {}

  private async hop(from: NetworkNode, to: NetworkNode, request: HostRequest, response?: HostResponse, dropped?: boolean): Promise<void> {
    this.bus.emit('net.message', { from, to, direction: response ? 'response' : 'request', request, response, ...(dropped ? { dropped } : {}) });
    if (!dropped) await this.clock.wait(this.config().hostHopLatencyMs);
  }

  async send(req: HostRequest): Promise<NetResult> {
    this.messagesSent++;
    const start = this.clock.now();
    await this.hop('ATM', 'CONTROLLER', req);
    await this.hop('CONTROLLER', 'SWITCH', req);

    if (this.faults.isArmed('host-unavailable')) {
      const response: HostResponse = {
        msgId: `${req.msgId}-R`,
        type: req.type,
        stan: req.stan,
        time: this.clock.now(),
        code: '91',
        approved: false,
        text: 'Issuer unavailable: the switch could not reach the bank host (request never arrived)',
      };
      await this.hop('SWITCH', 'CONTROLLER', req, response);
      await this.hop('CONTROLLER', 'ATM', req, response);
      return { response, timedOut: false };
    }

    await this.hop('SWITCH', 'HOST', req);
    await this.hop('HOST', 'LEDGER', req);
    const response = this.host.handle({ ...req });
    response.time = this.clock.now();
    await this.hop('LEDGER', 'HOST', req, response);
    await this.hop('HOST', 'SWITCH', req, response);

    if (req.type === 'WITHDRAWAL_AUTH' && this.faults.consume('network-timeout')) {
      await this.hop('SWITCH', 'CONTROLLER', req, response, true);
      const waited = this.clock.now() - start;
      await this.clock.wait(Math.max(0, this.config().hostTimeoutMs - waited));
      return { timedOut: true, lostResponse: response };
    }

    await this.hop('SWITCH', 'CONTROLLER', req, response);
    await this.hop('CONTROLLER', 'ATM', req, response);
    return { response, timedOut: false };
  }
}
