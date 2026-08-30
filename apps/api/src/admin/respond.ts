import type { ZodType } from 'zod';

/**
 * Devolve o corpo VALIDADO pelo contrato.
 *
 * O Zod remove chave desconhecida por padrao, entao a resposta passa a ser
 * limitada pelo mesmo schema contra o qual o console se tipa. Isso fecha duas
 * classes de defeito de uma vez, e as duas ja aconteceram neste repositorio:
 *
 *  - campo que o contrato declara e o mapper esquece (a `evidence` da quebra
 *    de conciliacao, que nunca saiu do banco);
 *  - campo que o mapper emite e o contrato nao declara (o
 *    `adjustment_transaction_id`, emitido por uma rota cujo contrato nao o
 *    conhece).
 *
 * Nenhum dos dois e pego por typecheck, porque o retorno de um handler Nest e
 * `unknown` na pratica. Aqui os dois viram erro em tempo de execucao no teste,
 * que e cedo o bastante.
 */
export function respond<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
