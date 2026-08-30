import { defineManifest } from '@baasconn/provider-spi';

/**
 * Manifesto da Dock — deliberadamente VAZIO.
 *
 * A Dock publica a referencia de API atras de portal de parceiro. O que esta
 * implementado e verificavel aqui e a AUTENTICACAO, que a documentacao publica
 * descreve, e mais nada.
 *
 * Declarar capacidades a partir de suposicao seria o pior desfecho possivel
 * para este projeto: a matriz publicada e o artefato de maior valor do repo, e
 * ela so vale enquanto ninguem precisar conferir se e verdade. Um esqueleto
 * honesto convida contribuicao de quem TEM acesso ao portal; um manifesto
 * inventado afasta essa pessoa, porque ela encontra codigo errado em vez de
 * espaco em branco.
 *
 * Cada capacidade nao declarada devolve 501 com a nota do manifesto, e as
 * issues de contribuicao estao abertas por capacidade.
 */
export const dockManifest = defineManifest({});
