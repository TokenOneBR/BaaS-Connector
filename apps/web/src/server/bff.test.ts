import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SERVER_DIR = join(import.meta.dirname);
const SRC_DIR = join(import.meta.dirname, '..');

/**
 * Codigo, sem comentario.
 *
 * As verificacoes abaixo procuram strings proibidas, e um comentario que
 * EXPLICA por que a string e proibida acusaria a si mesmo. Foi o que
 * aconteceu na primeira versao deste arquivo.
 */
function codigo(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')
        ? [join(dir, entry.name)]
        : [],
  );
}

/**
 * O console e um BFF, e estas sao as garantias que o tornam um.
 *
 * Nenhuma delas e verificavel por tipo, entao ficam aqui — sao propriedades
 * do ARQUIVO, e o modo de falha de todas e silencioso.
 */
describe('fronteira do BFF', () => {
  const modulosDeServidor = walk(SERVER_DIR).filter((file) => !file.endsWith('.test.ts'));

  it('todo modulo de `server/` importa `server-only`', () => {
    // E o que QUEBRA O BUILD se um deles entrar num bundle de cliente. Mais
    // forte que lint, e sem falso positivo — o lint nao le o conteudo do
    // arquivo e nao distingue Server Component de client component.
    for (const file of modulosDeServidor) {
      expect(readFileSync(file, 'utf8'), file).toContain("import 'server-only'");
    }
  });

  it('nenhum lugar do console escreve token em armazenamento do navegador', () => {
    // Se o token chegasse ao `localStorage`, um XSS o exfiltraria — e a razao
    // inteira de o Next ser BFF em vez de portador de token desapareceria.
    for (const file of walk(SRC_DIR).filter((f) => !f.includes('.test.'))) {
      const conteudo = codigo(file);
      expect(conteudo, file).not.toContain('localStorage');
      expect(conteudo, file).not.toContain('sessionStorage');
    }
  });

  it('so o cookie de CSRF e legivel por JavaScript', () => {
    const cookies = readFileSync(join(SERVER_DIR, 'cookies.ts'), 'utf8');
    // `httpOnly: true` nos dois de token, `false` so no de CSRF — que PRECISA
    // ser legivel, porque o formulario o ecoa num campo oculto.
    expect(cookies).toContain('httpOnly: true');
    expect(cookies.match(/httpOnly: false/g) ?? []).toHaveLength(1);
  });

  it('o cookie de CSRF e `strict`, e os de token sao `lax`', () => {
    const cookies = readFileSync(join(SERVER_DIR, 'cookies.ts'), 'utf8');
    // `strict` no de CSRF nao e preferencia: e o que impede um POST de outro
    // site de carregar o cookie, e portanto de o atacante LER o valor para
    // eco-lo. `lax` nos de token porque `strict` quebraria todo deep link.
    expect(cookies).toContain("sameSite: 'strict' as const");
    expect(cookies).toContain("sameSite: 'lax' as const");
  });

  it('a paleta so aparece no arquivo de tokens', () => {
    // Sem isto, a primeira pressa espalha `#FFC012` por vinte componentes e
    // trocar a marca vira caca ao tesouro.
    // O proprio teste precisa nomear a cor para procura-la; ele e a excecao.
    for (const file of walk(SRC_DIR).filter((f) => !f.endsWith('bff.test.ts'))) {
      expect(codigo(file).toUpperCase(), file).not.toContain('#FFC012');
    }
  });
});
