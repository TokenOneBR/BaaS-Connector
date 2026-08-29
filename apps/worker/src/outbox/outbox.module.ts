import { CLOCK, EnvelopeCrypto, type Clock } from '@baasconn/api/domain';
import { Module } from '@nestjs/common';

import { EndpointSecrets } from './endpoint-secrets.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { WebhookTransport } from './webhook-transport.js';

@Module({
  providers: [
    WebhookTransport,
    OutboxDispatcherService,
    {
      provide: EndpointSecrets,
      inject: [EnvelopeCrypto, CLOCK],
      useFactory: (crypto: EnvelopeCrypto, clock: Clock) => new EndpointSecrets(crypto, clock),
    },
  ],
  exports: [OutboxDispatcherService],
})
export class OutboxModule {}
