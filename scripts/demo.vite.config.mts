import swc from 'unplugin-swc';
import { defineConfig } from 'vite';

/**
 * Config do `vite-node` que executa o modo demo.
 *
 * `tsx` nao serve: usa esbuild, que NAO emite `emitDecoratorMetadata`. O
 * container de DI do Nest resolve dependencia por tipo, entao sem a metadata
 * a API nem sobe. Mesmo plugin e mesma configuracao do Vitest do repositorio.
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
