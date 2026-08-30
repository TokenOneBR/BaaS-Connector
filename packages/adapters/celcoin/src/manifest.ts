import { defineManifest } from '@baasconn/provider-spi';
import { SupportLevel } from '@baasconn/taxonomy';

/**
 * Manifesto da Celcoin.
 *
 * A regra editorial deste arquivo, e a razao de ele ser curto: **o que eu nao
 * consegui confirmar na documentacao publica sai UNSUPPORTED**. Declarar de
 * menos produz um 501 honesto, com a nota aparecendo no corpo do erro e na
 * matriz publicada, e uma issue de contribuicao. Declarar de mais produz erro
 * opaco em producao, e destroi a confianca na matriz inteira — que e o
 * artefato open source de maior valor do projeto.
 *
 * As fixtures deste adapter sao `handcrafted-from-docs`: escritas a partir da
 * documentacao, NAO gravadas contra sandbox. A conformidade prova que os
 * mappers sao coerentes com o que a documentacao descreve; nao prova que a
 * documentacao esta certa. Quem tiver credencial de sandbox deve regravar.
 */
export const celcoinManifest = defineManifest({
  'accounts.create.pf': {
    level: SupportLevel.SUPPORTED,
    docRef: 'https://developers.celcoin.com.br/reference/criar-conta-pf',
  },
  'accounts.create.pj': {
    level: SupportLevel.SUPPORTED,
    docRef: 'https://developers.celcoin.com.br/reference/criar-conta-pj',
  },
  'accounts.get': { level: SupportLevel.SUPPORTED },

  // O onboarding NAO e uma submissao separada: criar a conta gera a proposta,
  // que segue para background check e volta por webhook. O adapter le a
  // proposta existente em vez de submeter — que e exatamente o que EMULATED
  // significa, e a nota aparece no corpo de qualquer 501 relacionado.
  'onboarding.kyc.submit': {
    level: SupportLevel.EMULATED,
    note: 'A proposta e criada implicitamente por POST /account/natural-person/create; o adapter le a proposta em vez de submeter.',
  },
  'onboarding.kyb.submit': {
    level: SupportLevel.EMULATED,
    note: 'A proposta e criada implicitamente por POST /account/business/create; o adapter le a proposta em vez de submeter.',
  },
  'onboarding.status.get': { level: SupportLevel.SUPPORTED },

  'balance.get': {
    level: SupportLevel.PARTIAL,
    note: 'A Celcoin nem sempre devolve o instante da consulta; quando falta, o adapter usa o relogio do conector e a frescura declarada e a da chamada, nao a do provedor.',
  },

  'pix.keys.create': {
    level: SupportLevel.PARTIAL,
    note: 'Chaves PHONE e EMAIL exigem validacao por OTP fora deste fluxo; na pratica so CPF, CNPJ e EVP completam sem interacao.',
    constraints: { allowedPixKeyTypes: ['CPF', 'CNPJ', 'EVP'] },
  },
  'pix.keys.list': { level: SupportLevel.SUPPORTED },
  'pix.keys.delete': { level: SupportLevel.SUPPORTED },
  'pix.keys.resolve': {
    level: SupportLevel.PARTIAL,
    note: 'Consulta ao DICT consome o bucket de tokens do BACEN; o saldo do bucket volta no header x-bacen-bucket e nao e exposto pelo SPI.',
  },

  'pix.out.send': {
    level: SupportLevel.SUPPORTED,
    docRef: 'https://developers.celcoin.com.br/reference/realizar-transferencia-pix',
  },
  'pix.transaction.get': { level: SupportLevel.SUPPORTED },
});
