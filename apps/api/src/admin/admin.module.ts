import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module.js';

import { AdminAuthService } from './admin-auth.service.js';
import { AdminSessionGuard } from './admin-session.guard.js';
import { AdminSurfaceGuard } from './admin-surface.guard.js';
import { AdminController } from './admin.controller.js';
import { AdminTokenService } from './token.service.js';

/**
 * Console.
 *
 * Os repositorios (`CONSOLE_USER_REPOSITORY`, `CONSOLE_SESSION_REPOSITORY`)
 * vem do PersistenceModule, que e global: o modulo do console nao conhece o
 * Prisma, e o teste substitui os dois sem subir banco.
 */
@Module({
  imports: [ProvidersModule],
  controllers: [AdminController],
  providers: [AdminAuthService, AdminTokenService, AdminSessionGuard, AdminSurfaceGuard],
  exports: [AdminAuthService, AdminTokenService, AdminSessionGuard, AdminSurfaceGuard],
})
export class AdminModule {}
