import { Money, PixKeyType, TransactionStatus } from '@baasconn/taxonomy';
import { AccountStatus, OnboardingStatus } from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { toAccountStatus, toOnboardingStatus, taxIdOf } from '../src/mappers/account.js';
import { fromNumber, toNumber } from '../src/mappers/money.js';
import { toPixKeyType, toTransactionStatus } from '../src/mappers/pix.js';

/**
 * Mappers sao funcoes puras, entao sao testaveis sem HTTP — e e aqui que as
 * pegadinhas do wire da Celcoin ficam travadas. Um erro em qualquer um destes
 * so apareceria em producao como valor errado no extrato do cliente.
 */
describe('dinheiro', () => {
  it('converte numero JSON para centavos', () => {
    // A Celcoin manda `"amount": 1500.75`, nao string decimal nem centavos.
    expect(fromNumber(1500.75)).toEqual({ amount: '150075', currency: 'BRL', scale: 2 });
  });

  it('arredonda a representacao binaria em vez de truncar', () => {
    // 1.1 * 100 e 110.00000000000001 em ponto flutuante. `Math.trunc` daria
    // 110 aqui por sorte, mas 8.2 * 100 e 819.9999999999999 e truncaria para
    // 819 — um centavo a menos, em silencio, em toda transacao com esse valor.
    expect(fromNumber(8.2).amount).toBe('820');
    expect(fromNumber(1.1).amount).toBe('110');
    expect(fromNumber(0.07).amount).toBe('7');
  });

  it('zero e valores inteiros passam intactos', () => {
    expect(fromNumber(0).amount).toBe('0');
    expect(fromNumber(1500).amount).toBe('150000');
  });

  it('recusa valor nao finito em vez de gravar NaN', () => {
    // `NaN` viraria `BigInt(NaN)`, que lanca com mensagem opaca. Recusar aqui
    // aponta para o provedor, que e onde o defeito esta.
    expect(() => fromNumber(Number.NaN)).toThrow(TypeError);
    expect(() => fromNumber(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('faz round-trip pelo corpo de saida', () => {
    const canonico = Money.of(150_075n).toJSON();
    expect(fromNumber(toNumber(canonico))).toEqual(canonico);
  });
});

describe('chave PIX', () => {
  it('MAIL da Celcoin e EMAIL do BACEN', () => {
    // Sem esta linha toda chave de e-mail viraria EVP, e o cliente veria o
    // tipo errado no extrato e na tela.
    expect(toPixKeyType('MAIL')).toBe(PixKeyType.EMAIL);
    expect(toPixKeyType('EMAIL')).toBe(PixKeyType.EMAIL);
  });

  it('os demais tipos passam direto', () => {
    expect(toPixKeyType('CPF')).toBe(PixKeyType.CPF);
    expect(toPixKeyType('CNPJ')).toBe(PixKeyType.CNPJ);
    expect(toPixKeyType('PHONE')).toBe(PixKeyType.PHONE);
    expect(toPixKeyType('EVP')).toBe(PixKeyType.EVP);
  });
});

describe('situacao de pagamento', () => {
  it('CONFIRMED e liquidado', () => {
    expect(toTransactionStatus('CONFIRMED')).toBe(TransactionStatus.SETTLED);
  });

  it('desconhecido vira UNKNOWN, JAMAIS FAILED', () => {
    // FAILED autoriza o cliente a reenviar. Reenviar um pagamento cujo
    // desfecho nao conhecemos e o erro que custa dinheiro — e um status novo
    // que a Celcoin introduza cairia exatamente aqui.
    expect(toTransactionStatus('ALGUM_STATUS_NOVO')).toBe(TransactionStatus.UNKNOWN);
    expect(toTransactionStatus('')).toBe(TransactionStatus.UNKNOWN);
  });

  it('erro explicito do provedor e que vira FAILED', () => {
    expect(toTransactionStatus('ERROR')).toBe(TransactionStatus.FAILED);
    expect(toTransactionStatus('DENIED')).toBe(TransactionStatus.FAILED);
  });
});

describe('situacao de conta', () => {
  it('aceita os dois vocabularios que a documentacao usa', () => {
    expect(toAccountStatus('ACTIVE')).toBe(AccountStatus.ACTIVE);
    expect(toAccountStatus('ATIVA')).toBe(AccountStatus.ACTIVE);
  });

  it('desconhecido vira UNDER_REVIEW, nunca ACTIVE', () => {
    // ACTIVE por omissao liberaria movimentacao numa conta cujo estado real
    // nao conhecemos. Sob revisao bloqueia e chama humano.
    expect(toAccountStatus('SITUACAO_NOVA')).toBe(AccountStatus.UNDER_REVIEW);
  });
});

describe('situacao de proposta', () => {
  it('CONFIRMED e APPROVED sao o mesmo desfecho', () => {
    // A documentacao usa os dois nomes em lugares diferentes; mapear so um
    // deixaria metade das aprovacoes presas em analise para sempre.
    expect(toOnboardingStatus('CONFIRMED')).toBe(OnboardingStatus.APPROVED);
    expect(toOnboardingStatus('APPROVED')).toBe(OnboardingStatus.APPROVED);
  });

  it('desconhecido fica em analise', () => {
    expect(toOnboardingStatus('QUALQUER_COISA')).toBe(OnboardingStatus.IN_ANALYSIS);
  });
});

describe('documento', () => {
  it('distingue CPF de CNPJ pelo comprimento e normaliza', () => {
    // Digito verificador INVALIDO de proposito: o gate de PII do CI recusa
    // CPF valido em fixture, e um CPF sintetico da allowlist e canario de
    // vazamento do grupo 9 da conformidade. A intersecao dos dois so deixa
    // documento invalido.
    expect(taxIdOf('123.456.789-00')).toEqual({ type: 'CPF', value: '12345678900' });
    expect(taxIdOf('99.999.999/0001-99')).toEqual({ type: 'CNPJ', value: '99999999000199' });
  });
});
