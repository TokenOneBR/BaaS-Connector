import { BASE_REDACTION, extendRedaction } from '@baasconn/adapter-kit';

/**
 * Caminhos sensiveis no vocabulario do Mock Bank.
 *
 * O `BASE_REDACTION` cobre `*.cpf`, `*.taxId`, `*.document` — mas o Mock Bank
 * chama o documento de `documento` e `documento_titular`, e chave PIX de
 * `chave`. Sem estender, um CPF sairia em claro no log da chamada, e o grupo 9
 * da conformidade existe exatamente para pegar isso.
 */
export const redaction = extendRedaction(BASE_REDACTION, {
  maskPaths: [
    ...BASE_REDACTION.maskPaths,
    '*.documento',
    '*.documento_titular',
    '*.nome_titular',
    '*.client_secret',
    '*.access_token',
  ],
  hashPaths: [...(BASE_REDACTION.hashPaths ?? []), '*.chave', '*.conta', '*.emv'],
});
