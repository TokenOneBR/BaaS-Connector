#!/usr/bin/env tsx
/**
 * Gera docs/providers/capability-matrix.md a partir dos manifestos dos
 * adapters.
 *
 * A matriz e derivada, nunca escrita a mao: e assim que o projeto fica
 * impossibilitado de prometer mais do que implementou.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CAPABILITY_KEYS, SupportLevel, type CapabilityKey } from '@baasconn/taxonomy';
import type { ProviderAdapterFactory } from '@baasconn/provider-spi';

const ROOT = process.cwd();
const ADAPTERS_DIR = join(ROOT, 'packages/adapters');

const SYMBOL: Record<SupportLevel, string> = {
  [SupportLevel.SUPPORTED]: 'sim',
  [SupportLevel.PARTIAL]: 'parcial',
  [SupportLevel.EMULATED]: 'emulado',
  [SupportLevel.UNSUPPORTED]: '-',
};

/** Agrupamento legivel das chaves de capacidade. */
const GROUPS: Array<{ title: string; prefix: string }> = [
  { title: 'Contas', prefix: 'accounts.' },
  { title: 'Onboarding e compliance', prefix: 'onboarding.' },
  { title: 'Saldo', prefix: 'balance.' },
  { title: 'Chaves PIX', prefix: 'pix.keys.' },
  { title: 'Cobrancas PIX', prefix: 'pix.charge.' },
  { title: 'Movimentacao PIX', prefix: 'pix.' },
  { title: 'Extrato', prefix: 'statement.' },
  { title: 'Infraestrutura', prefix: 'webhooks.' },
];

async function loadFactories(): Promise<ProviderAdapterFactory[]> {
  const factories: ProviderAdapterFactory[] = [];
  for (const slug of readdirSync(ADAPTERS_DIR).sort()) {
    const entry = join(ADAPTERS_DIR, slug, 'dist/index.js');
    if (!existsSync(entry)) {
      console.warn(`  ignorando ${slug}: ${entry} nao existe (rode pnpm build antes)`);
      continue;
    }
    const module: Record<string, unknown> = await import(entry);
    for (const exported of Object.values(module)) {
      if (
        exported &&
        typeof exported === 'object' &&
        'slug' in exported &&
        'manifest' in exported &&
        'create' in exported
      ) {
        factories.push(exported as ProviderAdapterFactory);
      }
    }
  }
  return factories;
}

function assignedGroup(key: CapabilityKey): string {
  // Mais especifico primeiro: pix.keys. e pix.charge. antes de pix.
  const sorted = [...GROUPS].sort((a, b) => b.prefix.length - a.prefix.length);
  return sorted.find((g) => key.startsWith(g.prefix))?.title ?? 'Outros';
}

async function main(): Promise<void> {
  const factories = await loadFactories();
  if (factories.length === 0) {
    console.error('Nenhum adapter compilado encontrado. Rode `pnpm build` primeiro.');
    process.exit(1);
  }

  const header = ['| Capacidade | ' + factories.map((f) => f.displayName).join(' | ') + ' |'];
  const divider = ['|---|' + factories.map(() => ':---:').join('|') + '|'];

  const sections: string[] = [];
  for (const group of GROUPS) {
    const keys = CAPABILITY_KEYS.filter((k) => assignedGroup(k) === group.title);
    if (keys.length === 0) continue;

    const rows = keys.map((key) => {
      const cells = factories.map((f) => {
        const entry = f.manifest[key];
        const symbol = SYMBOL[entry.level];
        return entry.note ? `${symbol}[^${key}-${f.slug}]` : symbol;
      });
      return `| \`${key}\` | ${cells.join(' | ')} |`;
    });

    sections.push(`### ${group.title}\n\n${[...header, ...divider, ...rows].join('\n')}\n`);
  }

  const notes: string[] = [];
  for (const factory of factories) {
    for (const key of CAPABILITY_KEYS) {
      const entry = factory.manifest[key];
      if (entry.note)
        notes.push(`[^${key}-${factory.slug}]: **${factory.displayName}** — ${entry.note}`);
    }
  }

  const content = `# Matriz de capacidades

<!-- GERADO AUTOMATICAMENTE por scripts/gen-capability-matrix.ts. Nao edite. -->

Esta tabela vem dos \`CapabilityDescriptor\` dos adapters, entao ela nunca
promete mais do que o codigo entrega. A suite de conformidade verifica os dois
sentidos: capacidade declarada como suportada precisa funcionar, e capacidade
declarada como nao suportada precisa devolver \`CapabilityNotSupportedError\`.

**Legenda:** \`sim\` nativo · \`parcial\` com restricoes (ver nota) ·
\`emulado\` sintetizado pelo conector · \`-\` nao suportado (devolve 501).

${sections.join('\n')}
${notes.length ? `## Notas\n\n${notes.join('\n')}\n` : ''}`;

  const out = join(ROOT, 'docs/providers/capability-matrix.md');
  writeFileSync(out, content);
  console.warn(`Matriz gerada para ${factories.length} adapter(s): ${out}`);
}

void main();
