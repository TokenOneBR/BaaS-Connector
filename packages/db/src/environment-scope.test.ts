import { describe, expect, it } from 'vitest';

import { installBigIntSerializer } from './client.js';
import { applyEnvironmentScope, ENVIRONMENT_SCOPED_MODELS } from './environment-scope.js';

const HOMOLOG = 'HOMOLOGACAO' as never;

describe('escopo de ambiente', () => {
  it('injeta o filtro em leitura', () => {
    const args = applyEnvironmentScope(
      'Account',
      'findMany',
      { where: { status: 'ACTIVE' } },
      HOMOLOG,
    );
    expect(args.where).toEqual({ AND: [{ status: 'ACTIVE' }, { environment: 'HOMOLOGACAO' }] });
  });

  it('injeta o filtro mesmo sem where, que e o caso perigoso', () => {
    // Um findMany sem where devolveria os dois ambientes.
    const args = applyEnvironmentScope('Transaction', 'findMany', {}, HOMOLOG);
    expect(args.where).toEqual({ AND: [{}, { environment: 'HOMOLOGACAO' }] });
  });

  it('injeta o ambiente em criacao', () => {
    const args = applyEnvironmentScope('Account', 'create', { data: { id: 'acc_1' } }, HOMOLOG);
    expect(args.data).toMatchObject({ id: 'acc_1', environment: 'HOMOLOGACAO' });
  });

  it('injeta em createMany', () => {
    const args = applyEnvironmentScope(
      'Account',
      'createMany',
      { data: [{ id: 'acc_1' }, { id: 'acc_2' }] },
      HOMOLOG,
    );
    expect(args.data).toEqual([
      { environment: 'HOMOLOGACAO', id: 'acc_1' },
      { environment: 'HOMOLOGACAO', id: 'acc_2' },
    ]);
  });

  it('filtra em deleteMany, senao um delete apagaria os dois ambientes', () => {
    const args = applyEnvironmentScope('Transaction', 'deleteMany', { where: {} }, HOMOLOG);
    expect(args.where).toEqual({ AND: [{}, { environment: 'HOMOLOGACAO' }] });
  });

  it('mescla no topo em findUnique, senao o Prisma recusa', () => {
    const args = applyEnvironmentScope(
      'Account',
      'findUnique',
      { where: { id: 'acc_1' } },
      HOMOLOG,
    );

    // Envolver num AND tiraria `id` do topo e o Prisma responderia
    // "Argument where needs at least one of ...". O seletor unico precisa
    // continuar no primeiro nivel.
    expect(args.where).toEqual({ environment: 'HOMOLOGACAO', id: 'acc_1' });
    expect(args.where).not.toHaveProperty('AND');
  });

  it('mescla no topo em update e delete pelo mesmo motivo', () => {
    for (const operation of ['update', 'delete']) {
      const args = applyEnvironmentScope('Account', operation, { where: { id: 'acc_1' } }, HOMOLOG);
      expect(args.where, operation).toEqual({ environment: 'HOMOLOGACAO', id: 'acc_1' });
    }
  });

  it('no upsert filtra pelo unico e cria com ambiente', () => {
    const args = applyEnvironmentScope(
      'AccountBalance',
      'upsert',
      { where: { accountId: 'acc_1' }, create: { accountId: 'acc_1' } },
      HOMOLOG,
    );
    expect(args.where).toEqual({ environment: 'HOMOLOGACAO', accountId: 'acc_1' });
    expect(args.create).toEqual({ environment: 'HOMOLOGACAO', accountId: 'acc_1' });
  });

  it('um environment explicito do repositorio vence o injetado', () => {
    // O filtro explicito e o contrato; este helper e a rede. Se os dois
    // discordam, quem escreveu a query decide — e o teste de integracao dela
    // vai apontar a divergencia.
    const args = applyEnvironmentScope(
      'Account',
      'create',
      { data: { id: 'acc_1', environment: 'PRODUCAO' } },
      HOMOLOG,
    );
    expect(args.data).toMatchObject({ environment: 'PRODUCAO' });
  });

  it('nao mexe em modelo fora do escopo', () => {
    const args = applyEnvironmentScope('ConsoleUser', 'findMany', { where: {} }, HOMOLOG);
    expect(args.where).toEqual({});
  });

  it('cobre os modelos de negocio, ledger e operacao', () => {
    for (const model of [
      'Account',
      'Transaction',
      'LedgerEntry',
      'AuditLog',
      'IdempotencyRecord',
    ]) {
      expect(ENVIRONMENT_SCOPED_MODELS.has(model), model).toBe(true);
    }
    // Usuario do console e sessao existem uma vez so no deploy.
    expect(ENVIRONMENT_SCOPED_MODELS.has('ConsoleUser')).toBe(false);
  });
});

describe('serializacao de BigInt', () => {
  it('sem o patch, JSON.stringify de bigint lanca', () => {
    const proto = BigInt.prototype as unknown as { toJSON?: () => string };
    const original = proto.toJSON;
    delete proto.toJSON;
    expect(() => JSON.stringify({ amount: 1000n })).toThrow(/BigInt/);
    if (original) proto.toJSON = original;
  });

  it('com o patch, valores monetarios serializam como string', () => {
    installBigIntSerializer();
    // Todo valor monetario no schema e BIGINT: sem isto, qualquer resposta que
    // carregue dinheiro explodiria na serializacao.
    expect(JSON.stringify({ amount: 150075n })).toBe('{"amount":"150075"}');
  });
});
