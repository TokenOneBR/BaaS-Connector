import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AccountsController } from './accounts/accounts.controller.js';
import { AccountsService } from './accounts/accounts.service.js';
import { AuthController } from './common/auth.controller.js';
import { BearerAuthGuard, TokenService } from './common/auth.guard.js';
import { MockClock } from './common/clock.provider.js';
import { FaultInterceptor } from './common/fault.interceptor.js';
import { MockBankStore } from './common/store.js';
import { MockBankConfig } from './config/config.service.js';
import { ControlController } from './control/control.controller.js';
import { HealthController } from './health.controller.js';
import { LedgerService } from './ledger/ledger.service.js';
import { OnboardingService } from './onboarding/onboarding.service.js';
import { ChargesService } from './pix/charges.service.js';
import { PaymentsService } from './pix/payments.service.js';
import { PixKeysService } from './pix/pix-keys.service.js';
import { PixController } from './pix/pix.controller.js';
import { WebhookService } from './webhooks/webhook.service.js';

@Module({
  controllers: [
    HealthController,
    AuthController,
    AccountsController,
    PixController,
    ControlController,
  ],
  providers: [
    MockBankConfig,
    MockClock,
    MockBankStore,
    TokenService,
    BearerAuthGuard,
    LedgerService,
    AccountsService,
    OnboardingService,
    PixKeysService,
    ChargesService,
    PaymentsService,
    WebhookService,
    { provide: APP_INTERCEPTOR, useClass: FaultInterceptor },
  ],
})
export class AppModule {}
