import { Module } from '@nestjs/common';

import { OnboardingController } from '../onboarding/onboarding.controller.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { ProvidersModule } from '../providers/providers.module.js';

import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

/**
 * Contas e onboarding.
 *
 * Os dois moram juntos porque o caso de onboarding nao existe sem a conta e as
 * duas rotas compartilham o mesmo `ActorContext`. Separa-los criaria uma
 * dependencia circular entre modulos sem ganhar isolamento nenhum.
 */
@Module({
  imports: [ProvidersModule],
  controllers: [AccountsController, OnboardingController],
  providers: [AccountsService, OnboardingService],
  exports: [AccountsService, OnboardingService],
})
export class AccountsModule {}
