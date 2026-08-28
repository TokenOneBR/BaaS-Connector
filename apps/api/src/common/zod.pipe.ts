import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';
import { Injectable, PipeTransform, type ArgumentMetadata } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

/**
 * Validacao por schema Zod.
 *
 * O mesmo schema valida a requisicao, tipa o handler e gera o OpenAPI: tres
 * artefatos que nao podem divergir porque sao o mesmo objeto.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
      details: result.error.issues.map((issue) => ({
        field: issue.path.join('.') || undefined,
        code: issue.code,
        message: issue.message,
      })),
    });
  }
}

export const zodBody = (schema: ZodTypeAny) => new ZodValidationPipe(schema);
export const zodQuery = (schema: ZodTypeAny) => new ZodValidationPipe(schema);
