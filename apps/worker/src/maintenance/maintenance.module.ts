import { Module } from '@nestjs/common';

import { OutboxModule } from '../outbox/outbox.module.js';

import { SweepersService } from './sweepers.service.js';

/**
 * Varredores sub-minuto.
 *
 * Modulo proprio, e nao dentro de `OutboxModule`: o que mora aqui e o
 * AGENDAMENTO, e ele vai crescer para operacoes presas e conciliacao. Manter a
 * cadencia separada da logica e o que permite um teste chamar `sweepOutbox()`
 * direto, sem timer nenhum.
 */
@Module({
  imports: [OutboxModule],
  providers: [SweepersService],
  exports: [SweepersService],
})
export class MaintenanceModule {}
