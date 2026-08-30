import { defineManifest } from '@baasconn/provider-spi';

/**
 * Manifesto da QI Tech — deliberadamente VAZIO.
 *
 * A referencia de API da QI Tech fica atras de portal de parceiro. O que este
 * pacote entrega e verifica e o modelo de AUTENTICACAO, que e o mais incomum
 * dos cinco provedores e o unico que exigiu uma estrategia nova no kit:
 * assinatura ASSIMETRICA (ES512) da requisicao e verificacao da resposta.
 *
 * Declarar capacidade a partir de suposicao seria pior do que nao declarar:
 * a matriz publicada e o artefato de maior valor do repositorio, e ela so vale
 * enquanto ninguem precisar conferir se e verdade.
 */
export const qitechManifest = defineManifest({});
