import { defineManifest } from '@baasconn/provider-spi';
import { SupportLevel } from '@baasconn/taxonomy';

/**
 * Manifesto do Asaas.
 *
 * O Asaas e um gateway de cobranca com conta de pagamento acoplada, nao um
 * BaaS de abertura de conta. Ele tem saldo e chaves PIX, mas nao abre conta
 * de terceiro pelo mesmo caminho que Celcoin ou Dock — subconta e outro
 * fluxo, e nao foi possivel confirma-lo na documentacao publica.
 *
 * Fixtures `handcrafted-from-docs`. Ver `docs/providers/asaas.md`.
 */
export const asaasManifest = defineManifest({
  'balance.get': {
    level: SupportLevel.PARTIAL,
    note: 'O Asaas devolve apenas o saldo total; nao ha bloqueado nem a liberar, entao os dois saem ausentes em vez de zerados — zero afirmaria que nao ha bloqueio.',
    docRef: 'https://docs.asaas.com/reference/recuperar-saldo-da-conta',
  },
  'pix.keys.create': {
    level: SupportLevel.PARTIAL,
    note: 'A API publica so cria chave aleatoria (EVP); CPF, CNPJ, e-mail e telefone sao cadastrados pelo painel.',
    constraints: { allowedPixKeyTypes: ['EVP'] },
  },
  'pix.keys.list': { level: SupportLevel.SUPPORTED },
  'pix.keys.delete': { level: SupportLevel.SUPPORTED },
});
