import {
  AccountStatus,
  BreakSeverity,
  BreakStatus,
  OnboardingStatus,
  TransactionStatus,
} from '@baasconn/taxonomy';
import { describe, expect, it } from 'vitest';

import { MAPAS, toneFor } from './status-badge';

/**
 * Exaustividade verificada em RUNTIME, alem do tipo.
 *
 * O `Record<Enum, Tom>` ja torna um status novo um erro de compilacao. Este
 * teste itera os enums de verdade e cobra cada valor — a rede para o dia em
 * que alguem "consertar" o tipo com um `Partial` ou um cast.
 */
const ENUMS = {
  account: AccountStatus,
  transaction: TransactionStatus,
  onboarding: OnboardingStatus,
  break: BreakStatus,
  severity: BreakSeverity,
} as const;

describe('StatusBadge', () => {
  for (const [kind, enumeracao] of Object.entries(ENUMS)) {
    it(`cobre todo valor de ${kind}`, () => {
      const mapa = MAPAS[kind as keyof typeof MAPAS] as Record<string, string>;
      for (const valor of Object.values(enumeracao)) {
        expect(mapa[valor], `${kind}.${valor} sem tom definido`).toBeDefined();
      }
    });
  }

  it('UNKNOWN de transacao NAO e neutro', () => {
    // Significa "o dinheiro pode ter saido e nao sabemos" — o estado mais
    // importante do modelo. Cinza faria o operador passar direto.
    expect(toneFor('transaction', TransactionStatus.UNKNOWN)).toBe('warning');
  });

  it('status desconhecido cai em neutro em vez de quebrar a tela', () => {
    expect(toneFor('account', 'INVENTADO')).toBe('neutral');
  });
});
