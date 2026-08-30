import swc from 'unplugin-swc';
import { defineConfig } from 'vite';

/**
 * Config do `vite-node` que executa o processo do harness.
 *
 * `tsx` nao serve: ele usa esbuild, e o esbuild NAO emite
 * `emitDecoratorMetadata` — o container de DI do Nest resolve dependencia por
 * tipo, entao sem a metadata a API nem sobe. E a mesma razao de o Vitest
 * deste repositorio usar `unplugin-swc`, e o mesmo plugin com a mesma
 * configuracao aparece aqui de proposito: dois transformadores para o mesmo
 * codigo e como o teste de UI passa a exercitar um build que ninguem mais tem.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
