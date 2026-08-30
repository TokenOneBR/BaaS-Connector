import { BASE_REDACTION, extendRedaction } from '@baasconn/adapter-kit';

/**
 * Caminhos sensiveis proprios da Celcoin.
 *
 * `extendRedaction` ja concatena com a base, entao aqui vao SO os campos que a
 * base nao cobre. Repetir os da base nao quebra nada, mas esconde qual e a
 * contribuicao deste adapter.
 *
 * `owner.name` e `*.creditParty.name` entram porque nome de contraparte de PIX
 * e dado pessoal e aparece em toda resposta de DICT — e o DICT e a rota mais
 * chamada do produto.
 */
export const redaction = extendRedaction(BASE_REDACTION, {
  maskPaths: [
    '*.documentNumber',
    '*.owner.name',
    '*.owner.taxId',
    '*.creditParty.name',
    '*.debitParty.name',
    '*.businessEmail',
    '*.contactNumber',
  ],
  hashPaths: ['*.key', '*.emvqrcps'],
});
