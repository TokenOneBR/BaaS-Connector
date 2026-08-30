import { BASE_REDACTION, extendRedaction } from '@baasconn/adapter-kit';

/**
 * A base ja mascara `asaas-access-token`, que e o header de ENTRADA (webhook).
 * O de saida e `access_token`, e sem esta linha a chave da conexao apareceria
 * em texto claro em todo `ProviderCallRecord`.
 */
export const redaction = extendRedaction(BASE_REDACTION, {
  headers: { mask: ['access_token'], drop: [] },
  maskPaths: ['*.cpfCnpj', '*.customer', '*.ownerName'],
  hashPaths: ['*.pixAddressKey', '*.addressKey', '*.payload'],
});
