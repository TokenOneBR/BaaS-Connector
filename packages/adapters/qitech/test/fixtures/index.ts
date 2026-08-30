import type { Cassette } from '@baasconn/adapter-kit/testing';

export const happyPath: readonly Cassette[] = [];

/**
 * Vazio enquanto o manifesto tambem estiver vazio.
 *
 * A suite so exige fixture de erro de quem DECLARA capacidade: um esqueleto
 * que nao promete nada nao tem caminho de erro para mapear. Na primeira
 * capacidade declarada isto passa a ser obrigatorio, e a suite cobra.
 *
 * Toda fixture precisa de `source`: `'sandbox'` so quando foi gravada contra
 * execucao real; caso contrario `'handcrafted-from-docs'` mais `docsRef`. O
 * relatorio de conformidade publica a diferenca, e confundir as duas e como
 * uma fixture inventada vira "comportamento verificado".
 */
export const errors: readonly Cassette[] = [];
