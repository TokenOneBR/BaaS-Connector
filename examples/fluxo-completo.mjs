/**
 * O fluxo dourado, ponta a ponta, contra o Mock Bank.
 *
 *   pnpm demo                      # noutro terminal
 *   node examples/fluxo-completo.mjs
 *
 * Cria uma conta PJ, espera o onboarding aprovar por webhook, registra uma
 * chave PIX, recebe R$ 1.500, envia R$ 500 e confirma que uma transferencia
 * acima do saldo e recusada ANTES de qualquer chamada ao provedor.
 *
 * As credenciais saem do `pnpm demo`. Exporte antes de rodar:
 *   export BAAS_API_KEY=bck_hml_...
 *   export BAAS_SIGNING_SECRET=...
 */
import { BaasApiError, BaasConnector, BaasOutcomeUnknown } from '@baasconn/sdk';

const baas = new BaasConnector({
  baseUrl: process.env.BAAS_URL ?? 'http://localhost:3001',
  apiKey: required('BAAS_API_KEY'),
  // As rotas de dinheiro exigem assinatura HMAC. O SDK assina sozinho; sem
  // isto, um PIX out responde 401 e nao 422.
  signingSecret: required('BAAS_SIGNING_SECRET'),
});

function required(nome) {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Falta ${nome}. Copie do que o \`pnpm demo\` imprimiu.`);
    process.exit(1);
  }
  return valor;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O Mock Bank decide o cenario pelos DOIS ULTIMOS digitos do documento.
 * `...81` aprova; `...01` pede documentos; `...03` casa sancoes e recusa.
 * Ver `docs/providers/mock-bank.md`.
 */
function pj(nome, email) {
  return {
    external_id: `exemplo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    holder: {
      type: 'BUSINESS',
      tax_id: { type: 'CNPJ', value: '11222333000181' },
      legal_name: nome,
      email,
      phone: { country_code: '55', area_code: '11', number: '999998888' },
      incorporation_date: '2020-01-15',
      addresses: [
        {
          postal_code: '01310100',
          street: 'Avenida Paulista',
          number: '1000',
          district: 'Bela Vista',
          city: 'Sao Paulo',
          state: 'SP',
        },
      ],
      representatives: [
        {
          role: 'ADMINISTRATOR',
          tax_id: { type: 'CPF', value: '52998224725' },
          full_name: 'Maria Souza',
          birth_date: '1985-03-20',
          is_ultimate_beneficial_owner: true,
          is_signer: true,
        },
      ],
    },
  };
}

async function ativar(dados) {
  const conta = await baas.accounts.create(dados);
  // O onboarding e assincrono: o Mock Bank aprova e AVISA por webhook. Um
  // teste que dormisse um tempo fixo ficaria intermitente; este espera a
  // condicao de verdade.
  for (let i = 0; i < 30; i += 1) {
    const atual = await baas.accounts.get(conta.id);
    if (atual.status === 'ACTIVE') return atual;
    await espera(1000);
  }
  throw new Error(`Conta ${conta.id} nao ficou ACTIVE a tempo.`);
}

const reais = (m) => `R$ ${(Number(m.amount) / 100).toFixed(2)}`;

// 1. Conta pagadora ------------------------------------------------------
const pagadora = await ativar(pj('Padaria Central LTDA', 'financeiro@padaria.test'));
console.log(`conta pagadora   ${pagadora.id}  ${pagadora.status}`);

// 2. Conta recebedora, com chave registrada ------------------------------
//    O DICT do Mock Bank recusa chave inexistente com 404 — o erro mais comum
//    de PIX out na vida real. Sem um destino de verdade, o teste mediria isso
//    em vez do fluxo.
const recebedora = await ativar(pj('Recebedor LTDA', 'recebedor@exemplo.test'));
await baas.pixKeys.create(recebedora.id, { type: 'EMAIL', value: 'recebedor@exemplo.test' });
console.log(`conta recebedora ${recebedora.id}  chave EMAIL registrada`);

// 3. Chave PIX da pagadora, para receber ---------------------------------
const chave = await baas.pixKeys.create(pagadora.id, { type: 'EVP' });
console.log(`chave EVP        ${chave.value}`);

// 4. Alguem paga R$ 1.500 -------------------------------------------------
//    `_control` e o painel do banco FALSO: injeta um PIX como se um terceiro
//    tivesse pagado. Nao existe num provedor real.
await fetch(`${process.env.MOCK_BANK_URL ?? 'http://localhost:3002'}/_control/pix/inbound`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pix_key: chave.value, amount: '1500.00', payer_name: 'Cliente Teste' }),
});
await espera(3000);
console.log(`saldo            ${reais((await baas.accounts.balance(pagadora.id)).available)}`);

// 5. PIX out de R$ 500 ----------------------------------------------------
try {
  const txn = await baas.pixTransfers.send(pagadora.id, {
    amount: { amount: '50000', currency: 'BRL', scale: 2 },
    destination: { kind: 'pix_key', key: 'recebedor@exemplo.test', key_type: 'EMAIL' },
  });
  console.log(`PIX out          ${txn.id}  ${txn.status}`);
} catch (erro) {
  if (erro instanceof BaasOutcomeUnknown) {
    // O dinheiro PODE ter saido. Nunca reenvie: consulte a operacao.
    console.log(`desfecho desconhecido, operacao ${erro.operationId}`);
  } else throw erro;
}
await espera(3000);
console.log(`saldo            ${reais((await baas.accounts.balance(pagadora.id)).available)}`);

// 6. Acima do saldo -------------------------------------------------------
//    Recusado pelo razao sombra ANTES de chamar o provedor: o hold e o que
//    faz duas transferencias concorrentes nao gastarem o mesmo dinheiro.
try {
  await baas.pixTransfers.send(pagadora.id, {
    amount: { amount: '99900000', currency: 'BRL', scale: 2 },
    destination: { kind: 'pix_key', key: 'recebedor@exemplo.test', key_type: 'EMAIL' },
  });
  console.error('ERRO: a transferencia acima do saldo deveria ter sido recusada.');
  process.exit(1);
} catch (erro) {
  if (!(erro instanceof BaasApiError)) throw erro;
  console.log(`acima do saldo   ${erro.status} ${erro.code}`);
}

console.log('\nFluxo completo.');
