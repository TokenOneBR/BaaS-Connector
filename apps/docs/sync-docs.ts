#!/usr/bin/env tsx
/**
 * Copia `docs/` para `apps/docs/docs/` antes do build.
 *
 * A FONTE e `docs/` na raiz: e onde os guias vivem, e onde um PR de adapter
 * naturalmente edita, e o que `docs/providers/capability-matrix.md` regenera.
 * Manter uma segunda copia versionada aqui criaria duas verdades, e a de
 * dentro do site — que ninguem edita a mao — seria a que apodrece.
 *
 * A copia e gerada e ignorada pelo git; so `index.md` e proprio do site.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '../..');
const DESTINO = join(import.meta.dirname, 'docs');

/** O que entra no site publico. `openapi.json` vai para `static/`. */
const PASTAS = ['guides', 'providers', 'adr', 'taxonomy'];

const GITHUB = 'https://github.com/TokenOneBR/BaaS-Connector/blob/main';

for (const pasta of PASTAS) {
  const origem = join(RAIZ, 'docs', pasta);
  if (!existsSync(origem)) {
    console.error(`docs/${pasta} nao existe.`);
    process.exit(1);
  }
  rmSync(join(DESTINO, pasta), { recursive: true, force: true });
  cpSync(origem, join(DESTINO, pasta), { recursive: true });
  reescreverLinksExternos(join(DESTINO, pasta));
}

/**
 * Aponta para o GitHub os links que SAEM da arvore publicada.
 *
 * `SECURITY.md`, `CONTRIBUTING.md` e `LICENSE` vivem na raiz do repositorio e
 * nao viram pagina do site. Deixa-los como caminho relativo quebra o build
 * (`onBrokenLinks: 'throw'`, de proposito); apaga-los perderia a referencia.
 * Reescrever preserva o destino e mantem o arquivo original legivel no
 * GitHub, que e onde ele e editado.
 */
function reescreverLinksExternos(dir: string): void {
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      reescreverLinksExternos(caminho);
      continue;
    }
    if (!entrada.endsWith('.md')) continue;

    const original = readFileSync(caminho, 'utf8');
    // `../../ARQUIVO.md` sobe para fora de `docs/` — e so esses sobem dois
    // niveis a partir de uma subpasta de `docs/`.
    const reescrito = original.replace(
      /\]\(\.\.\/\.\.\/([A-Z][A-Za-z_.-]*\.md)\)/g,
      `](${GITHUB}/$1)`,
    );
    if (reescrito !== original) writeFileSync(caminho, reescrito);
  }
}

/**
 * Indice dos ADRs, gerado a partir dos arquivos.
 *
 * Escrito a mao, ele ficaria desatualizado no primeiro ADR novo — e um indice
 * de decisoes de arquitetura que nao lista a decisao mais recente e pior que
 * indice nenhum.
 */
const adrs = readdirSync(join(DESTINO, 'adr'))
  // `0000-template` fica de fora da TABELA: e um formulario, nao uma decisao.
  // O arquivo continua publicado, porque e o que alguem abre para escrever o
  // proximo ADR.
  .filter((arquivo) => /^\d{4}-.+\.md$/.test(arquivo) && !arquivo.startsWith('0000-'))
  .sort();

const linhas = adrs.map((arquivo) => {
  const numero = arquivo.slice(0, 4);
  const titulo = arquivo
    .slice(5, -3)
    .split('-')
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
  // Com extensao `.md`: o Docusaurus resolve link relativo de documento pelo
  // ARQUIVO, e sem ela reporta link quebrado e o build para — de proposito,
  // porque `onBrokenLinks: 'throw'`.
  return `| [${numero}](./${arquivo}) | ${titulo} |`;
});

writeFileSync(
  join(DESTINO, 'adr/index.md'),
  `---
title: Decisoes de arquitetura
sidebar_position: 0
---

# Decisoes de arquitetura

Um ADR e obrigatorio para toda mudanca no modelo canonico ou no SPI. O
processo e: issue \`taxonomy_change.yml\` -> discussao -> PR do ADR -> PR da
implementacao. Sem isso, as decisoes viram folclore e a primeira pessoa nova
as desfaz sem saber que foram decisoes.

| # | Decisao |
|---|---|
${linhas.join('\n')}

Para escrever o proximo, comece pelo [modelo](./0000-template.md).

<!-- gerado por apps/docs/sync-docs.ts -->
`,
);

// A spec fica em `static/` para ser servida crua em `/openapi.json`: um SDK
// gerado por ferramenta de terceiro aponta para uma URL, nao para uma pagina.
mkdirSync(join(import.meta.dirname, 'static'), { recursive: true });
cpSync(join(RAIZ, 'docs/openapi.json'), join(import.meta.dirname, 'static/openapi.json'));

console.warn(`Sincronizado: ${PASTAS.join(', ')} e openapi.json (${adrs.length} ADRs).`);
