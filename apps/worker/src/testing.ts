/**
 * Ponto de entrada para testes de fora do pacote.
 *
 * Simetrico ao `./app` e ao `./testing` da API, e pela mesma razao: a suite de
 * ponta a ponta precisa dos servicos de conciliacao, que moram aqui, sem
 * alcancar `src/**` por caminho relativo atravessando a fronteira do pacote.
 *
 * O que sai daqui sao os SERVICOS, nao o grafo de DI do worker. O e2e prova o
 * FLUXO — quebra semeada, quebra aberta, ajuste lancado —, e a fiacao ja tem
 * teste proprio (`worker.module.test.ts`) e o BullMQ ja tem o dele contra
 * Redis de verdade. Montar o container inteiro no e2e seria repetir a prova
 * cara e nao acrescentar cobertura.
 */
export { ReconciliationService, DEFAULT_POLICY } from './reconciliation/reconciliation.service.js';
export { AutoResolutionService } from './reconciliation/auto-resolution.service.js';
export { RECONCILIATION_STATUSES, mirrorsProviderMovement } from './reconciliation/normalizers.js';
