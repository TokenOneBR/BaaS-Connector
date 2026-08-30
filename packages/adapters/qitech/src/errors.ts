import { COMMON_ERROR_MAPPINGS, type ErrorMapping } from '@baasconn/adapter-kit';

/**
 * Mais especifico primeiro.
 *
 * Toda fixture em test/fixtures/errors/ precisa mapear para algo diferente do
 * fallback PROVIDER_REJECTED: e assim que a tabela nao apodrece.
 */
export const errorMappings: readonly ErrorMapping[] = [...COMMON_ERROR_MAPPINGS];
