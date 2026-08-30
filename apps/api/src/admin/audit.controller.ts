import { zAuditLog, zAuditVerification, zListAuditQuery } from '@baasconn/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import {
  AUDIT_REPOSITORY,
  type AuditRecord,
  type AuditRepository,
} from '../events/outbox.types.js';

import { MinRole } from './admin-session.guard.js';
import { ConsoleEnvironmentPipe, type EnvironmentQuery } from './environment.query.js';
import { respond } from './respond.js';

const zVerifyQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * Trilha de auditoria.
 *
 * `COMPLIANCE`, e nao `OPERATOR`: `COMPLIANCE` tem posto ABAIXO de `OPERATOR`,
 * e esta e a tela que existe para o papel de compliance. Marca-la como
 * OPERATOR trancaria exatamente quem deveria le-la.
 *
 * Somente leitura, e nao por convencao: a porta nao tem `update` nem `delete`,
 * o papel do banco tampouco, e um trigger `BEFORE UPDATE OR DELETE` recusa
 * independente do papel.
 */
@Controller('admin/v1/audit')
@Public()
export class AuditController {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {}

  @Get()
  @MinRole('COMPLIANCE')
  async list(
    @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery,
    @Query(new ZodValidationPipe(zListAuditQuery)) query: z.infer<typeof zListAuditQuery>,
  ) {
    const page = await this.audit.list({
      environment: env.environment,
      actorId: query.actor_id,
      action: query.action,
      resourceType: query.resource_type,
      resourceId: query.resource_id,
      from: query.occurred_after ? new Date(query.occurred_after) : undefined,
      to: query.occurred_before ? new Date(query.occurred_before) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      object: 'list' as const,
      data: page.data.map(toDto),
      page: {
        has_more: page.nextCursor !== undefined,
        next_cursor: page.nextCursor ?? null,
        prev_cursor: null,
        limit: query.limit,
      },
    };
  }

  /**
   * Percorre a cadeia e devolve a PRIMEIRA divergencia.
   *
   * A formula do encadeamento vive numa funcao SQL ao lado do trigger que a
   * calcula. Reimplementa-la aqui criaria duas definicoes da mesma formula, e
   * elas divergem na primeira mudanca — o sintoma seria acusar adulteracao
   * que nao houve, ou, pior, deixar de ver a que houve.
   */
  @Get('verify')
  @MinRole('COMPLIANCE')
  async verify(
    @Query(ConsoleEnvironmentPipe) env: EnvironmentQuery,
    @Query(new ZodValidationPipe(zVerifyQuery)) query: z.infer<typeof zVerifyQuery>,
  ) {
    const result = await this.audit.verifyChain({
      environment: env.environment,
      from: query.from ? new Date(query.from) : new Date(0),
      to: query.to ? new Date(query.to) : new Date('2100-01-01T00:00:00.000Z'),
    });

    return respond(zAuditVerification, {
      verified: result.verified,
      checked_count: result.checkedCount,
      from: result.from.toISOString(),
      to: result.to.toISOString(),
      first_divergence: result.firstDivergence
        ? {
            audit_id: result.firstDivergence.auditId,
            sequence: result.firstDivergence.sequence,
            occurred_at: result.firstDivergence.occurredAt.toISOString(),
          }
        : null,
    });
  }
}

function toDto(row: AuditRecord) {
  return respond(zAuditLog, {
    id: row.id,
    environment: row.environment,
    // String, e nao numero: a coluna e `BigInt` e o wire nao tem bigint. A
    // conversao acontece no repositorio, antes de `respond` — o serializador
    // global de bigint corrige `toJSON`, que roda tarde demais.
    sequence: row.sequence,
    actor_type: row.actorType,
    actor_id: row.actorId ?? null,
    actor_label: row.actorLabel ?? null,
    actor_ip: row.actorIp ?? null,
    action: row.action,
    outcome: row.outcome,
    error_code: row.errorCode ?? null,
    resource_type: row.resourceType,
    resource_id: row.resourceId ?? null,
    before: row.before ?? null,
    after: row.after ?? null,
    changed_fields: row.changedFields,
    request_id: row.requestId ?? null,
    occurred_at: row.occurredAt.toISOString(),
  });
}
