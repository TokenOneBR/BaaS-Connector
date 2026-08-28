import {
  AccountStatus,
  HolderType,
  Money,
  OnboardingDecision,
  OnboardingRejectionCode,
  OnboardingStatus,
  RequirementCode,
  StatementEntryType,
  TransactionStatus,
} from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import type { MbAccount, MbOnboarding, MbPayment } from '../src/dto/index.js';
import {
  taxIdOf,
  toAccountStatus,
  toAccountStatusFromEvent,
  toHolderType,
  toProviderAccount,
} from '../src/mappers/account.js';
import { fromCents, fromDecimal, toDecimal } from '../src/mappers/money.js';
import { toOnboardingCase } from '../src/mappers/onboarding.js';
import { toPixTransaction, toStatementEntry, toTransactionStatus } from '../src/mappers/pix.js';

const account: MbAccount = {
  id: 'acc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  tipo_pessoa: 'PJ',
  documento: '11222333000181',
  nome: 'Exemplo LTDA',
  email: 'a@b.com',
  situacao: 'ATIVA',
  agencia: '0001',
  conta: '1000001',
  conta_digito: '3',
  ispb: '99999001',
  id_externo: null,
  criado_em: '2026-08-28T12:00:00.000Z',
  aberto_em: '2026-08-28T12:00:01.000Z',
};

describe('dinheiro', () => {
  it('le decimal do REST e centavos do webhook para o mesmo valor', () => {
    // O Mock Bank fala dinheiro de DUAS formas. Trocar as duas leituras produz
    // um erro de fator 100 que passa em revisao porque os dois valores parecem
    // plausiveis — este teste e o que impede isso.
    expect(fromDecimal('1500.00')).toEqual(fromCents('150000'));
    expect(fromDecimal('1500.00').amount).toBe('150000');
  });

  it('nao perde centavo em round-trip', () => {
    for (const value of ['0.01', '0.99', '1.00', '150.75', '9999999.99']) {
      expect(toDecimal(fromDecimal(value))).toBe(value);
    }
  });

  it('le centavos como bigint, sem passar por number', () => {
    // 9007199254740993 e maior que Number.MAX_SAFE_INTEGER: passar por float
    // perderia o ultimo digito silenciosamente.
    const huge = '9007199254740993';
    expect(fromCents(huge).amount).toBe(huge);
    expect(Money.fromJSON(fromCents(huge)).cents).toBe(9007199254740993n);
  });
});

describe('conta', () => {
  it('inverte o vocabulario portugues do REST', () => {
    const table: Array<[string, AccountStatus]> = [
      ['ATIVA', AccountStatus.ACTIVE],
      ['BLOQUEADA', AccountStatus.BLOCKED],
      ['SUSPENSA', AccountStatus.SUSPENDED],
      ['RECUSADA', AccountStatus.REJECTED],
      ['ENCERRADA', AccountStatus.CLOSED],
      ['EM_ENCERRAMENTO', AccountStatus.CLOSING],
      ['EM_ANALISE', AccountStatus.UNDER_REVIEW],
    ];
    for (const [situacao, expected] of table) {
      expect(toAccountStatus(situacao), situacao).toBe(expected);
    }
  });

  it('aceita tambem o vocabulario ingles, que e o do webhook', () => {
    // O mesmo provedor usa os dois: REST em portugues, evento em ingles.
    expect(toAccountStatusFromEvent('ACTIVE')).toBe(AccountStatus.ACTIVE);
    expect(toAccountStatusFromEvent('BLOCKED')).toBe(AccountStatus.BLOCKED);
    expect(toAccountStatusFromEvent('ATIVA')).toBe(AccountStatus.ACTIVE);
  });

  it('status desconhecido segura movimentacao em vez de liberar', () => {
    // Um `default` otimista transformaria um status novo do provedor em ATIVA
    // silenciosamente, e uma conta bloqueada tratada como ativa e uma
    // transferencia que nao deveria sair.
    expect(toAccountStatus('SITUACAO_QUE_NAO_EXISTE')).toBe(AccountStatus.UNDER_REVIEW);
    expect(toAccountStatus('SITUACAO_QUE_NAO_EXISTE')).not.toBe(AccountStatus.ACTIVE);
  });

  it('deriva o tipo de documento pelo tamanho', () => {
    expect(taxIdOf('11222333000181')).toEqual({ type: 'CNPJ', value: '11222333000181' });
    expect(taxIdOf('529.982.247-25')).toEqual({ type: 'CPF', value: '52998224725' });
    expect(toHolderType('PJ')).toBe(HolderType.BUSINESS);
    expect(toHolderType('PF')).toBe(HolderType.INDIVIDUAL);
  });

  it('mapeia a conta inteira', () => {
    expect(toProviderAccount(account)).toMatchObject({
      providerAccountId: account.id,
      status: AccountStatus.ACTIVE,
      personType: HolderType.BUSINESS,
      bank: { ispb: '99999001', branch: '0001', number: '1000001', checkDigit: '3' },
      openedAt: '2026-08-28T12:00:01.000Z',
    });
  });
});

describe('onboarding', () => {
  const base: MbOnboarding = {
    id: 'onb_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    conta_id: account.id,
    tipo: 'KYB',
    situacao: 'PENDING_REQUIREMENTS',
    pendencias: [
      { codigo: 'SELFIE_LIVENESS', situacao: 'PENDING' },
      { codigo: 'PROOF_OF_ADDRESS', situacao: 'PENDING' },
    ],
    verificacoes: [],
    motivo_recusa: null,
    mensagem_recusa: null,
    atualizado_em: '2026-08-28T12:00:00.000Z',
  };

  it('devolve o conjunto COMPLETO de pendencias, nao um delta', () => {
    // O core faz set-diff contra o que ja tinha. Devolver delta faria a lista
    // virar append-only e nunca limpar — a falha classica de integracao de KYC.
    const mapped = toOnboardingCase(base);
    expect(mapped.pendingRequirements.map((r) => r.code)).toEqual([
      RequirementCode.SELFIE_LIVENESS,
      RequirementCode.PROOF_OF_ADDRESS,
    ]);
  });

  it('descarta pendencia de codigo desconhecido em vez de quebrar', () => {
    const mapped = toOnboardingCase({
      ...base,
      pendencias: [{ codigo: 'CODIGO_INVENTADO', situacao: 'PENDING' }],
    });
    expect(mapped.pendingRequirements).toEqual([]);
  });

  it('preserva o codigo de recusa do provedor junto do canonico', () => {
    const mapped = toOnboardingCase({
      ...base,
      situacao: 'REJECTED',
      motivo_recusa: 'SANCTIONS_MATCH',
      mensagem_recusa: 'Recusado na analise automatica',
    });

    expect(mapped.status).toBe(OnboardingStatus.REJECTED);
    expect(mapped.decision).toMatchObject({
      outcome: OnboardingDecision.REJECT,
      reasonCode: OnboardingRejectionCode.SANCTIONS_MATCH,
      // O codigo cru do provedor sobrevive para a escalacao ao suporte deles.
      providerReasonCode: 'SANCTIONS_MATCH',
    });
  });

  it('recusa com codigo fora do catalogo vira PROVIDER_POLICY', () => {
    const mapped = toOnboardingCase({
      ...base,
      situacao: 'REJECTED',
      motivo_recusa: 'MOTIVO_QUE_NAO_EXISTE',
    });
    expect(mapped.decision?.reasonCode).toBe(OnboardingRejectionCode.PROVIDER_POLICY);
    expect(mapped.decision?.providerReasonCode).toBe('MOTIVO_QUE_NAO_EXISTE');
  });

  it('caso nao decidido nao carrega decisao', () => {
    expect(toOnboardingCase(base).decision).toBeUndefined();
  });
});

describe('transacao', () => {
  const payment: MbPayment = {
    id: 'txn_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    conta_id: account.id,
    tipo: 'DEBITO',
    situacao: 'PROCESSING',
    valor: '100.00',
    tarifa: '0.00',
    end_to_end_id: null,
    id_devolucao: null,
    txid: null,
    contraparte: { name: 'Fulano', taxId: '52998224725', ispb: '99999001' },
    descricao: null,
    data_movimento: '2026-08-28T12:00:00.000Z',
    data_liquidacao: null,
  };

  it('aceita endToEndId nulo na criacao', () => {
    // Nulo ate PROCESSING, muitas vezes ate SETTLED: e o PSP do PAGADOR que o
    // cunha. Assumir que existe na criacao e a pegadinha classica do PIX.
    const mapped = toPixTransaction(payment);
    expect(mapped.endToEndId).toBeUndefined();
    expect(mapped.status).toBe(TransactionStatus.PROCESSING);
    expect(mapped.direction).toBe('out');
  });

  it('status desconhecido vira UNKNOWN, jamais FAILED', () => {
    // FAILED autoriza o cliente a reenviar. Reenviar um pagamento cujo
    // desfecho nao conhecemos e exatamente o erro que custa dinheiro.
    expect(toTransactionStatus('SITUACAO_NOVA')).toBe(TransactionStatus.UNKNOWN);
    expect(toTransactionStatus('SITUACAO_NOVA')).not.toBe(TransactionStatus.FAILED);
  });

  it('mapeia contraparte de camelCase para canonico', () => {
    // A contraparte tem chaves camelCase dentro de um envelope snake_case.
    expect(toPixTransaction(payment).counterparty).toEqual({
      name: 'Fulano',
      taxId: { type: 'CPF', value: '52998224725' },
      ispb: '99999001',
      branch: undefined,
      accountNumber: undefined,
    });
  });

  it('usa o dia bancario brasileiro no extrato, nao UTC', () => {
    // Um PIX das 22h em Sao Paulo cai no dia seguinte em UTC. Usar a data UTC
    // faria o extrato do cliente mostrar o dia errado.
    const entry = toStatementEntry({
      ...payment,
      situacao: 'SETTLED',
      data_liquidacao: '2026-08-29T01:30:00.000Z',
    });
    expect(entry.effectiveDate).toBe('2026-08-28');
    expect(entry.direction).toBe('debit');
    expect(entry.type).toBe(StatementEntryType.PIX_OUT);
  });

  it('classifica devolucao no extrato', () => {
    const entry = toStatementEntry({ ...payment, id_devolucao: 'D99999001202608281200ABC' });
    expect(entry.type).toBe(StatementEntryType.REFUND);
  });
});
