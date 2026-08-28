import { createHash } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  AccountStatus,
  Money,
  OnboardingStatus,
  PixKeyType,
  TransactionStatus,
} from '@baasconn/taxonomy';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { MockClock } from '../src/common/clock.provider.js';
import { LedgerService } from '../src/ledger/ledger.service.js';

/**
 * Documentos sinteticos com digito verificador valido, gerados para este
 * repositorio. O sufixo controla o cenario de onboarding.
 */
const CPF_APROVA = '52998224725'; // ...25 -> caminho feliz
const CNPJ_APROVA = '11222333000181'; // ...81 -> caminho feliz
const CPF_PENDENCIAS = '58692322601'; // ...01 -> pede selfie e comprovante
const CPF_RECUSA = '10433218100'; // ...00 -> recusa por divergencia
const CPF_REVISAO = '95134332002'; // ...02 -> mesa de analise
const CPF_SANCOES = '08412411803'; // ...03 -> lista de sancoes
const CPF_BLOQUEADA = '16934060806'; // ...06 -> aprova, abre bloqueada

describe('Mock Bank', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let clock: MockClock;
  let ledger: LedgerService;
  /** URL real: o teste de concorrencia precisa de sockets de verdade. */
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    http = request(app.getHttpServer());
    clock = app.get(MockClock);
    ledger = app.get(LedgerService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await http.post('/_control/reset').expect(201);
    const auth = await http
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'mock-client',
        client_secret: 'mock-secret',
      })
      .expect(201);
    token = auth.body.access_token;
  });

  const authed = () => http;
  const bearer = () => ({ Authorization: `Bearer ${token}` });

  async function createAccount(document = CNPJ_APROVA, type: 'PF' | 'PJ' = 'PJ') {
    const response = await authed()
      .post('/api/v1/contas')
      .set(bearer())
      .send({ tipo_pessoa: type, documento: document, nome: 'Exemplo LTDA', email: 'a@b.com' })
      .expect(201);
    return response.body;
  }

  async function sendDocument(accountId: string, codigo: string) {
    return authed()
      .post(`/api/v1/contas/${accountId}/onboarding/documentos`)
      .query({ codigo })
      .set(bearer())
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from(`conteudo-${codigo}`))
      .expect(201);
  }

  async function fund(accountId: string, amount: string) {
    await authed()
      .post('/_control/pix/inbound')
      .send({ account_id: accountId, amount })
      .expect(201);
  }

  describe('autenticacao', () => {
    it('emite token com credenciais corretas', async () => {
      const response = await http
        .post('/api/v1/auth/token')
        .send({ client_id: 'mock-client', client_secret: 'mock-secret' })
        .expect(201);
      expect(response.body).toMatchObject({ token_type: 'Bearer' });
      expect(response.body.access_token).toBeTruthy();
    });

    it('recusa credenciais erradas', async () => {
      await http
        .post('/api/v1/auth/token')
        .send({ client_id: 'x', client_secret: 'y' })
        .expect(401);
    });

    it('recusa requisicao sem token', async () => {
      await http.get('/api/v1/contas').expect(401);
    });

    it('recusa token invalido', async () => {
      await http.get('/api/v1/contas').set({ Authorization: 'Bearer nao-existe' }).expect(401);
    });
  });

  describe('abertura de conta e onboarding', () => {
    it('abre conta e aprova no caminho feliz', async () => {
      const account = await createAccount();
      expect(account.situacao).toBe('EM_ANALISE');

      const detail = await authed().get(`/api/v1/contas/${account.id}`).set(bearer()).expect(200);
      expect(detail.body.situacao).toBe('ATIVA');
      expect(detail.body.agencia).toBe('0001');
      expect(detail.body.ispb).toBe('99999001');
    });

    it('recusa documento invalido', async () => {
      await authed()
        .post('/api/v1/contas')
        .set(bearer())
        .send({ tipo_pessoa: 'PF', documento: '11111111111', nome: 'X', email: 'a@b.com' })
        .expect(422);
    });

    it('deduplica por documento: nao cria duas contas para o mesmo CPF', async () => {
      const first = await createAccount(CPF_APROVA, 'PF');
      const second = await createAccount(CPF_APROVA, 'PF');
      expect(second.id).toBe(first.id);
    });

    it('CPF terminado em 01 pede documentos e aprova quando chegam', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');
      const onboarding = await authed()
        .get(`/api/v1/contas/${account.id}/onboarding`)
        .set(bearer())
        .expect(200);

      expect(onboarding.body.dados.situacao).toBe(OnboardingStatus.PENDING_REQUIREMENTS);
      expect(onboarding.body.dados.pendencias.map((p: { codigo: string }) => p.codigo)).toEqual([
        'SELFIE_LIVENESS',
        'PROOF_OF_ADDRESS',
      ]);

      const detail = await authed().get(`/api/v1/contas/${account.id}`).set(bearer()).expect(200);
      expect(detail.body.situacao).toBe('EM_ANALISE');
    });

    it('envia documento e cumpre a pendencia', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');
      const bytes = Buffer.from('selfie-falsa-de-teste');

      const response = await authed()
        .post(`/api/v1/contas/${account.id}/onboarding/documentos`)
        .query({ codigo: 'SELFIE_LIVENESS' })
        .set(bearer())
        .set('Content-Type', 'application/octet-stream')
        .send(bytes)
        .expect(201);

      expect(response.body).toMatchObject({
        codigo: 'SELFIE_LIVENESS',
        situacao: 'ACEITO',
        tamanho_bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });

      // Uma pendencia cumprida, a outra continua aberta e o caso NAO aprova.
      expect(response.body.onboarding.pendencias.map((p: { codigo: string }) => p.codigo)).toEqual([
        'PROOF_OF_ADDRESS',
      ]);
      expect(response.body.onboarding.situacao).toBe(OnboardingStatus.PENDING_REQUIREMENTS);
    });

    it('cumprir a ultima pendencia aprova e abre a conta', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');

      await sendDocument(account.id, 'SELFIE_LIVENESS');
      const last = await sendDocument(account.id, 'PROOF_OF_ADDRESS');

      expect(last.body.onboarding.situacao).toBe(OnboardingStatus.APPROVED);

      const detail = await authed().get(`/api/v1/contas/${account.id}`).set(bearer()).expect(200);
      expect(detail.body.situacao).toBe('ATIVA');
    });

    it('recusa sha256 divergente', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');

      // Um upload truncado por rede instavel e indistinguivel de um arquivo
      // legitimo sem esta checagem: a pendencia ficaria "cumprida" com metade
      // de um documento.
      const response = await authed()
        .post(`/api/v1/contas/${account.id}/onboarding/documentos`)
        .query({ codigo: 'SELFIE_LIVENESS' })
        .set(bearer())
        .set('Content-Type', 'application/octet-stream')
        .set('x-conteudo-sha256', 'f'.repeat(64))
        .send(Buffer.from('conteudo-real'))
        .expect(422);

      expect(response.body.error.code).toBe('MB-DOC-422');
    });

    it('recusa documento vazio', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');
      const response = await authed()
        .post(`/api/v1/contas/${account.id}/onboarding/documentos`)
        .query({ codigo: 'SELFIE_LIVENESS' })
        .set(bearer())
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(0))
        .expect(422);
      expect(response.body.error.code).toBe('MB-DOC-422');
    });

    it('recusa codigo fora das pendencias do caso', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');
      const response = await authed()
        .post(`/api/v1/contas/${account.id}/onboarding/documentos`)
        .query({ codigo: 'UBO_DECLARATION' })
        .set(bearer())
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('x'))
        .expect(422);
      expect(response.body.error.code).toBe('MB-ONB-422');
    });

    it('recusa a mesma pendencia duas vezes', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');
      await sendDocument(account.id, 'SELFIE_LIVENESS');

      const again = await authed()
        .post(`/api/v1/contas/${account.id}/onboarding/documentos`)
        .query({ codigo: 'SELFIE_LIVENESS' })
        .set(bearer())
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('outra-selfie'))
        .expect(422);
      expect(again.body.error.code).toBe('MB-ONB-422');
    });

    it('recusa envio em caso que nao aguarda documento', async () => {
      // Conta do caminho feliz ja aprovou: aceitar documento aqui seria
      // aceitar prova para uma decisao ja tomada.
      const account = await createAccount(CPF_APROVA, 'PF');
      const response = await authed()
        .post(`/api/v1/contas/${account.id}/onboarding/documentos`)
        .query({ codigo: 'SELFIE_LIVENESS' })
        .set(bearer())
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('x'))
        .expect(422);
      expect(response.body.error.code).toBe('MB-ONB-422');
    });

    it('recusa envio para conta inexistente', async () => {
      // A conta e resolvida antes do caso, entao o 404 e da CONTA e nao do
      // onboarding — dizer "onboarding nao encontrado" para um id de conta que
      // nunca existiu mandaria o suporte procurar no lugar errado.
      const response = await authed()
        .post('/api/v1/contas/acc_01ARZ3NDEKTSV4RRFFQ69G5FAV/onboarding/documentos')
        .query({ codigo: 'SELFIE_LIVENESS' })
        .set(bearer())
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('x'))
        .expect(404);
      expect(response.body.error.code).toBe('MB-CONTA-404');
    });

    it('CPF terminado em 00 recusa por divergencia com a Receita', async () => {
      const account = await createAccount(CPF_RECUSA, 'PF');
      const detail = await authed().get(`/api/v1/contas/${account.id}`).set(bearer()).expect(200);
      expect(detail.body.situacao).toBe('RECUSADA');

      const onboarding = await authed()
        .get(`/api/v1/contas/${account.id}/onboarding`)
        .set(bearer())
        .expect(200);
      expect(onboarding.body.dados.motivo_recusa).toBe('DATA_MISMATCH');
    });

    it('painel de controle forca uma decisao', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');
      const onboarding = await authed()
        .get(`/api/v1/contas/${account.id}/onboarding`)
        .set(bearer());

      await authed()
        .post('/_control/onboarding/decide')
        .send({ onboarding_id: onboarding.body.dados.id, decision: 'APPROVE' })
        .expect(201);

      const detail = await authed().get(`/api/v1/contas/${account.id}`).set(bearer()).expect(200);
      expect(detail.body.situacao).toBe('ATIVA');
    });
  });

  describe('chaves Pix e DICT', () => {
    it('cria chave EVP e lista', async () => {
      const account = await createAccount();
      const key = await authed()
        .post(`/api/v1/contas/${account.id}/chaves`)
        .set(bearer())
        .send({ tipo: PixKeyType.EVP })
        .expect(201);

      expect(key.body.chave).toMatch(/^[0-9a-f-]{36}$/);
      const list = await authed()
        .get(`/api/v1/contas/${account.id}/chaves`)
        .set(bearer())
        .expect(200);
      expect(list.body.dados).toHaveLength(1);
    });

    it('recusa chave duplicada', async () => {
      const account = await createAccount();
      await authed()
        .post(`/api/v1/contas/${account.id}/chaves`)
        .set(bearer())
        .send({ tipo: PixKeyType.CNPJ, chave: CNPJ_APROVA })
        .expect(201);
      await authed()
        .post(`/api/v1/contas/${account.id}/chaves`)
        .set(bearer())
        .send({ tipo: PixKeyType.CNPJ, chave: CNPJ_APROVA })
        .expect(409);
    });

    it('DICT resolve chave existente', async () => {
      const account = await createAccount();
      await authed()
        .post(`/api/v1/contas/${account.id}/chaves`)
        .set(bearer())
        .send({ tipo: PixKeyType.CNPJ, chave: CNPJ_APROVA });

      const resolved = await authed().get(`/api/v1/dict/${CNPJ_APROVA}`).set(bearer()).expect(200);
      expect(resolved.body.documento_titular).toBe(CNPJ_APROVA);
      expect(resolved.body.ispb).toBe('99999001');
    });

    it('DICT devolve 404 para chave inexistente, que e o erro mais comum de PIX out', async () => {
      await authed().get('/api/v1/dict/naoexiste@exemplo.com').set(bearer()).expect(404);
    });
  });

  describe('PIX in', () => {
    it('credita a conta e o saldo reflete', async () => {
      const account = await createAccount();
      await fund(account.id, '1500.00');

      const balance = await authed()
        .get(`/api/v1/contas/${account.id}/saldo`)
        .set(bearer())
        .expect(200);
      expect(balance.body.saldo_disponivel).toBe('1500.00');
      expect(balance.body.moeda).toBe('BRL');
    });

    it('gera EndToEndId no formato do BACEN', async () => {
      const account = await createAccount();
      const response = await authed()
        .post('/_control/pix/inbound')
        .send({ account_id: account.id, amount: '100.00' })
        .expect(201);

      // O E2EID de um PIX de ENTRADA e cunhado pelo PSP do PAGADOR, entao o
      // ISPB nao e o nosso. O que precisa valer e o formato do BACEN.
      expect(response.body.end_to_end_id).toMatch(/^E\d{8}\d{12}[A-Za-z0-9]{11}$/);
      expect(response.body.end_to_end_id).toHaveLength(32);
    });

    it('paga uma cobranca e marca como concluida', async () => {
      const account = await createAccount();
      await authed()
        .post(`/api/v1/contas/${account.id}/chaves`)
        .set(bearer())
        .send({ tipo: PixKeyType.CNPJ, chave: CNPJ_APROVA });

      const charge = await authed()
        .post(`/api/v1/contas/${account.id}/cobrancas`)
        .set(bearer())
        .send({ tipo: 'DINAMICA', chave: CNPJ_APROVA, valor: '250.00' })
        .expect(201);

      // O payload EMV vem do codec canonico, o mesmo que o conector usa.
      expect(charge.body.emv).toContain('br.gov.bcb.pix');

      await authed().post('/_control/pix/pay-charge').send({ txid: charge.body.txid }).expect(201);

      const updated = await authed()
        .get(`/api/v1/cobrancas/${charge.body.txid}`)
        .set(bearer())
        .expect(200);
      expect(updated.body.situacao).toBe('COMPLETED');
      expect(updated.body.valor_pago).toBe('250.00');
    });
  });

  describe('PIX out', () => {
    async function fundedAccountPair() {
      const payer = await createAccount(CNPJ_APROVA, 'PJ');
      const payee = await createAccount(CPF_APROVA, 'PF');
      await authed()
        .post(`/api/v1/contas/${payee.id}/chaves`)
        .set(bearer())
        .send({ tipo: PixKeyType.CPF, chave: CPF_APROVA });
      await fund(payer.id, '1000.00');
      return { payer, payee };
    }

    it('debita o pagador e credita o recebedor', async () => {
      const { payer } = await fundedAccountPair();

      const payment = await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set(bearer())
        .send({ valor: '250.00', chave: CPF_APROVA })
        .expect(201);

      expect(payment.body.end_to_end_id).toMatch(/^E99999001/);
      expect(payment.body.contraparte.taxId).toBe(CPF_APROVA);

      const balance = await authed()
        .get(`/api/v1/contas/${payer.id}/saldo`)
        .set(bearer())
        .expect(200);
      expect(balance.body.saldo_disponivel).toBe('750.00');
    });

    it('e idempotente: a mesma chave devolve o mesmo pagamento', async () => {
      const { payer } = await fundedAccountPair();
      const body = { valor: '100.00', chave: CPF_APROVA };

      const first = await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set({ ...bearer(), 'x-idempotency-key': 'mesma-chave' })
        .send(body)
        .expect(201);

      const second = await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set({ ...bearer(), 'x-idempotency-key': 'mesma-chave' })
        .send(body)
        .expect(201);

      expect(second.body.id).toBe(first.body.id);

      const balance = await authed().get(`/api/v1/contas/${payer.id}/saldo`).set(bearer());
      expect(balance.body.saldo_disponivel).toBe('900.00');
    });

    it('recusa acima do saldo, sem lancamento no razao', async () => {
      const { payer } = await fundedAccountPair();
      await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set(bearer())
        .send({ valor: '5000.00', chave: CPF_APROVA })
        .expect(400);

      const balance = await authed().get(`/api/v1/contas/${payer.id}/saldo`).set(bearer());
      expect(balance.body.saldo_disponivel).toBe('1000.00');
      expect(ledger.verifyInvariants()).toEqual({ ok: true });
    });

    it('valor terminado em ,13 forca saldo insuficiente mesmo havendo saldo', async () => {
      const { payer } = await fundedAccountPair();
      const response = await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set(bearer())
        .send({ valor: '10.13', chave: CPF_APROVA })
        .expect(400);
      expect(response.body.error.code).toBe('MB-SALDO-001');
    });

    it('valor terminado em ,51 forca erro do provedor', async () => {
      const { payer } = await fundedAccountPair();
      const response = await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set(bearer())
        .send({ valor: '10.51', chave: CPF_APROVA })
        .expect(500);
      expect(response.body.error.code).toBe('MB-CHAOS-500');
    });

    it('recusa chave de destino inexistente', async () => {
      const { payer } = await fundedAccountPair();
      await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set(bearer())
        .send({ valor: '10.00', chave: 'naoexiste@exemplo.com' })
        .expect(404);
    });

    it('recusa movimentacao de conta nao ativa', async () => {
      const account = await createAccount(CPF_PENDENCIAS, 'PF');
      await authed()
        .post(`/api/v1/contas/${account.id}/pix/enviar`)
        .set(bearer())
        .send({ valor: '10.00', chave: CPF_APROVA })
        .expect(400);
    });

    it('busca pela chave de idempotencia, que resolve desfecho desconhecido', async () => {
      const { payer } = await fundedAccountPair();
      await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set({ ...bearer(), 'x-idempotency-key': 'chave-busca' })
        .send({ valor: '10.00', chave: CPF_APROVA })
        .expect(201);

      const found = await authed()
        .get('/api/v1/pix')
        .query({ idempotency_key: 'chave-busca' })
        .set(bearer())
        .expect(200);
      expect(found.body.dados).not.toBeNull();
    });

    it('devolve null quando a chave de idempotencia nao existe', async () => {
      const found = await authed()
        .get('/api/v1/pix')
        .query({ idempotency_key: 'nunca-usada' })
        .set(bearer())
        .expect(200);
      expect(found.body.dados).toBeNull();
    });
  });

  describe('devolucao', () => {
    it('devolve integralmente e reverte a original', async () => {
      const account = await createAccount();
      const inbound = await authed()
        .post('/_control/pix/inbound')
        .send({ account_id: account.id, amount: '500.00' })
        .expect(201);

      const refund = await authed()
        .post(`/api/v1/contas/${account.id}/pix/devolver`)
        .set(bearer())
        .send({ end_to_end_id_original: inbound.body.end_to_end_id, motivo: 'OPERATIONAL_ERROR' })
        .expect(201);

      expect(refund.body.id_devolucao).toMatch(/^D99999001/);

      const balance = await authed().get(`/api/v1/contas/${account.id}/saldo`).set(bearer());
      expect(balance.body.saldo_disponivel).toBe('0.00');
    });

    it('recusa devolucao que excede o valor original', async () => {
      const account = await createAccount();
      const inbound = await authed()
        .post('/_control/pix/inbound')
        .send({ account_id: account.id, amount: '100.00' });

      await authed()
        .post(`/api/v1/contas/${account.id}/pix/devolver`)
        .set(bearer())
        .send({
          end_to_end_id_original: inbound.body.end_to_end_id,
          valor: '150.00',
          motivo: 'OPERATIONAL_ERROR',
        })
        .expect(422);
    });

    it('recusa devolucao fora da janela de 90 dias', async () => {
      const account = await createAccount();
      const inbound = await authed()
        .post('/_control/pix/inbound')
        .send({ account_id: account.id, amount: '100.00' });

      // O relogio logico evita esperar 90 dias de verdade. Como o token
      // tambem expira contra esse relogio (comportamento correto), reautentica.
      await authed().post('/_control/clock/advance').send({ days: 91 }).expect(201);
      const reauth = await http
        .post('/api/v1/auth/token')
        .send({ client_id: 'mock-client', client_secret: 'mock-secret' })
        .expect(201);
      token = reauth.body.access_token;

      const response = await authed()
        .post(`/api/v1/contas/${account.id}/pix/devolver`)
        .set(bearer())
        .send({ end_to_end_id_original: inbound.body.end_to_end_id, motivo: 'OPERATIONAL_ERROR' })
        .expect(422);
      expect(response.body.error.code).toBe('MB-DEVOL-001');
    });
  });

  describe('painel de controle', () => {
    it('injeta latencia', async () => {
      await authed().post('/_control/faults').send({ latency_ms: 120 }).expect(201);
      const started = Date.now();
      await authed().get('/api/v1/contas').set(bearer()).expect(200);
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
      await authed().post('/_control/faults/clear').expect(201);
    });

    it('forca status por header, sem alterar a configuracao global', async () => {
      await authed()
        .get('/api/v1/contas')
        .set({ ...bearer(), 'x-mock-scenario': 'rate-limited' })
        .expect(429);
      await authed().get('/api/v1/contas').set(bearer()).expect(200);
    });

    it('o proprio painel continua respondendo com caos ligado', async () => {
      await authed().post('/_control/faults').send({ error_rate: 1 }).expect(201);
      // Se o interceptor nao isentasse /_control, nao daria para desligar.
      await authed().post('/_control/faults/clear').expect(201);
    });

    it('avanca e reseta o relogio logico', async () => {
      const before = await authed().get('/_control/clock').expect(200);
      await authed().post('/_control/clock/advance').send({ days: 30 }).expect(201);
      const after = await authed().get('/_control/clock').expect(200);
      expect(new Date(after.body.now).getTime()).toBeGreaterThan(
        new Date(before.body.now).getTime(),
      );

      await authed().post('/_control/clock/reset').expect(201);
    });

    it('esquece uma transacao, produzindo quebra de conciliacao deterministica', async () => {
      const account = await createAccount();
      const inbound = await authed()
        .post('/_control/pix/inbound')
        .send({ account_id: account.id, amount: '100.00' });

      await authed()
        .post('/_control/forget-transaction')
        .send({ transaction_id: inbound.body.transaction_id })
        .expect(201);

      const extrato = await authed()
        .get(`/api/v1/contas/${account.id}/extrato`)
        .set(bearer())
        .expect(200);
      expect(extrato.body.dados).toHaveLength(0);
    });

    it('documenta os valores magicos', async () => {
      const response = await authed().get('/_control/magic').expect(200);
      expect(response.body.onboarding.suffixes['01']).toBe('PENDING_DOCUMENTS');
      expect(response.body.pixOut.cents['29']).toBe('TIMEOUT');
    });
  });

  describe('invariantes do razao', () => {
    it('debitos igualam creditos apos o fluxo completo', async () => {
      const payer = await createAccount(CNPJ_APROVA, 'PJ');
      const payee = await createAccount(CPF_APROVA, 'PF');
      await authed()
        .post(`/api/v1/contas/${payee.id}/chaves`)
        .set(bearer())
        .send({ tipo: PixKeyType.CPF, chave: CPF_APROVA });

      await fund(payer.id, '1000.00');
      await authed()
        .post(`/api/v1/contas/${payer.id}/pix/enviar`)
        .set(bearer())
        .send({ valor: '300.00', chave: CPF_APROVA })
        .expect(201);

      const verification = await authed().get('/_control/ledger/verify').expect(200);
      expect(verification.body).toEqual({ ok: true });
    });
  });

  /**
   * O teste que define correto no Mock Bank: sob disputa, o saldo nunca fica
   * negativo e o numero de pagamentos liquidados e exatamente o que cabia.
   */
  describe('concorrencia', () => {
    it('200 PIX-outs concorrentes com saldo para 100 liquidam exatamente 100', async () => {
      const payer = await createAccount(CNPJ_APROVA, 'PJ');
      const payee = await createAccount(CPF_APROVA, 'PF');
      await authed()
        .post(`/api/v1/contas/${payee.id}/chaves`)
        .set(bearer())
        .send({ tipo: PixKeyType.CPF, chave: CPF_APROVA });

      // R$ 10,00 por pagamento, saldo para exatamente 100.
      await fund(payer.id, '1000.00');

      // fetch contra o servidor escutando de verdade: supertest abre um socket
      // por requisicao e 200 simultaneos estouram o backlog, o que nao diz nada
      // sobre o ledger.
      const attempts = Array.from({ length: 200 }, (_, i) =>
        fetch(`${baseUrl}/api/v1/contas/${payer.id}/pix/enviar`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
            'x-idempotency-key': `concorrente-${i}`,
          },
          body: JSON.stringify({ valor: '10.00', chave: CPF_APROVA }),
        }).then((response) => response.status),
      );

      const statuses = await Promise.all(attempts);
      const accepted = statuses.filter((status) => status === 201).length;
      const rejected = statuses.filter((status) => status === 400).length;

      expect(accepted).toBe(100);
      expect(rejected).toBe(100);

      const balance = await authed().get(`/api/v1/contas/${payer.id}/saldo`).set(bearer());
      expect(balance.body.saldo_disponivel).toBe('0.00');
      expect(ledger.verifyInvariants()).toEqual({ ok: true });
    }, 60_000);
  });

  describe('health', () => {
    it('liveness nao depende de nada externo', async () => {
      await http.get('/healthz').expect(200);
      await http.get('/readyz').expect(200);
    });
  });
});
