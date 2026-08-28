#!/usr/bin/env tsx
/**
 * Gate de CI: nenhuma fixture pode conter dado pessoal ou segredo real.
 *
 * Fixtures sao gravadas contra sandbox de provedor e passam por um scrubber,
 * mas scrubber tem falha. Este e o gate que impede um CPF real de virar
 * historico publico do git, onde nao da para apagar.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIRS = ['packages/adapters', 'e2e', 'apps/mock-bank/test'];

interface Finding {
  file: string;
  rule: string;
  sample: string;
}

/** Digito verificador modulo 11 de CPF e CNPJ. */
function mod11(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * (weights[i] ?? 0), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isRealCpf(value: string): boolean {
  if (value.length !== 11 || /^(\d)\1{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  return (
    d[9] === mod11(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) &&
    d[10] === mod11(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  );
}

function isRealCnpj(value: string): boolean {
  if (value.length !== 14 || /^(\d)\1{13}$/.test(value)) return false;
  const d = [...value].map(Number);
  return (
    d[12] === mod11(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) &&
    d[13] === mod11(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  );
}

/**
 * Documentos sinteticos usados de proposito nos testes e nas fixtures.
 * Sao validos no modulo 11 (por isso passam nos schemas) mas nao pertencem a
 * ninguem: foram gerados para este repositorio.
 */
const ALLOWED_SYNTHETIC = new Set([
  '52998224725',
  '11222333000181',
  '11144477735',
  // Documentos por sufixo de valor magico do Mock Bank.
  '10433218100',
  '58692322601',
  '95134332002',
  '08412411803',
  '04499727804',
  '62704828105',
  '16934060806',
  // CNPJs sinteticos do e2e: o sufixo do valor magico E o digito verificador,
  // entao precisam ser validos para o contrato aceita-los.
  '10000008000101',
  '10000015000103',
  '10000017000100',
]);

const PATTERNS: Array<{ rule: string; regex: RegExp; validate?: (m: string) => boolean }> = [
  {
    rule: 'CPF com digito verificador valido',
    regex: /\b\d{11}\b/g,
    validate: (m) => isRealCpf(m) && !ALLOWED_SYNTHETIC.has(m),
  },
  {
    rule: 'CNPJ com digito verificador valido',
    regex: /\b\d{14}\b/g,
    validate: (m) => isRealCnpj(m) && !ALLOWED_SYNTHETIC.has(m),
  },
  { rule: 'Token em formato JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g },
  {
    rule: 'Bloco PEM de chave privada',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  { rule: 'Chave de API da Stripe', regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g },
  {
    rule: 'Access key da AWS',
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    // `.ts` tambem: o scaffolder gera as fixtures em TypeScript, entao um
    // gate que so olhasse JSON nao protegeria nenhum adapter. Varrer o `src`
    // junto e de proposito — um documento cravado num mapper vaza igual.
    else if (/\.(json|yaml|yml|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const findings: Finding[] = [];
let scanned = 0;

for (const dir of SEARCH_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    scanned++;
    const content = readFileSync(file, 'utf8');
    // Digitos com separador nao sao documento; normalizamos so para os testes
    // de CPF/CNPJ, mantendo o texto original para os demais padroes.
    const normalized = content.replace(/(\d)[.\-/](?=\d)/g, '$1');

    for (const { rule, regex, validate } of PATTERNS) {
      const haystack = validate ? normalized : content;
      for (const match of haystack.matchAll(regex)) {
        const value = match[0];
        if (validate && !validate(value)) continue;
        findings.push({
          file: relative(ROOT, file),
          rule,
          sample: value.length > 12 ? `${value.slice(0, 6)}...` : value,
        });
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`\nEncontrado dado sensivel em ${findings.length} ocorrencia(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}\n    ${f.rule}: ${f.sample}`);
  }
  console.error(
    '\nFixtures precisam usar documentos sinteticos e credenciais redigidas.',
    '\nVer docs/guides/recording-fixtures.md.\n',
  );
  process.exit(1);
}

console.warn(`check-cassette-pii: ${scanned} arquivo(s) verificado(s), nada encontrado.`);
