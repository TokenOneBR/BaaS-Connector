import { Controller, Get } from '@nestjs/common';

import { MockClock } from './common/clock.provider.js';

@Controller()
export class HealthController {
  constructor(private readonly clock: MockClock) {}

  /** Liveness do processo. Nao toca nada externo, de proposito. */
  @Get('healthz')
  health() {
    return { status: 'ok', now: this.clock.now().toISOString() };
  }

  @Get('readyz')
  ready() {
    return { status: 'ready' };
  }
}
