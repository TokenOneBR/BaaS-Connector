import { integrationPreset } from '@baasconn/vitest-config/integration';

/**
 * Testes com Redis de verdade.
 *
 * Separados de `pnpm test` de proposito: o BullMQ depende de comandos
 * bloqueantes, filas com atraso e locks, e um dobro em memoria erraria
 * exatamente essa semantica. Mesma razao pela qual a conformidade usa um
 * servidor HTTP real em vez de interceptar `fetch`.
 */
export default integrationPreset();
