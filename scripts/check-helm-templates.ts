#!/usr/bin/env tsx
/**
 * Verificacao ESTRUTURAL dos templates do chart.
 *
 * NAO substitui `helm lint` e `helm template`, que rodam no CI com o binario
 * de verdade. Existe porque o helm nao e instalavel em todo ambiente de
 * desenvolvimento — o proxy de egresso deste projeto bloqueia `get.helm.sh` —
 * e porque os erros que ela pega sao os que mais aparecem: um `if` sem `end`,
 * um `{{` sem fechar, um `range` desbalanceado.
 *
 * O que ela NAO pega, dito explicitamente: indentacao errada dentro de um
 * bloco, campo invalido do Kubernetes, e qualquer coisa que dependa de
 * RENDERIZAR. Para isso existem os manifests planos em `deploy/k8s/examples/`,
 * que sao YAML de verdade e passam por `kubeconform`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATES = join(process.cwd(), 'deploy/helm/baas-connector/templates');

/** Acoes que ABREM um bloco e exigem `end`. */
const ABRE = /^\s*(if|range|with|define|block)\b/;
const SENAO = /^\s*(else|else\s+if)\b/;
const FECHA = /^\s*end\s*$/;

let falhas = 0;

for (const arquivo of readdirSync(TEMPLATES).filter((f) => f !== 'NOTES.txt')) {
  const conteudo = readFileSync(join(TEMPLATES, arquivo), 'utf8');

  const abre = (conteudo.match(/\{\{/g) ?? []).length;
  const fecha = (conteudo.match(/\}\}/g) ?? []).length;
  if (abre !== fecha) {
    console.error(`${arquivo}: ${abre} '{{' para ${fecha} '}}'`);
    falhas += 1;
    continue;
  }

  // Acoes ANINHADAS (`{{ "{{ $labels.x }}" }}`) sao literais para o helm e
  // nao contam como bloco. Sao retiradas antes da contagem, senao o alerta
  // do Prometheus — que emite template do proprio Prometheus — acusaria
  // desbalanceamento que nao existe.
  const semLiterais = conteudo.replace(/\{\{\s*"[^"]*"\s*\}\}/g, '');

  let profundidade = 0;
  for (const [, acao] of semLiterais.matchAll(/\{\{-?\s*(.*?)\s*-?\}\}/gs)) {
    if (FECHA.test(acao)) profundidade -= 1;
    else if (ABRE.test(acao)) profundidade += 1;
    else if (SENAO.test(acao)) continue;

    if (profundidade < 0) {
      console.error(`${arquivo}: 'end' sem bloco correspondente`);
      falhas += 1;
      break;
    }
  }

  if (profundidade > 0) {
    console.error(`${arquivo}: ${profundidade} bloco(s) sem 'end'`);
    falhas += 1;
  }
}

if (falhas > 0) {
  console.error(`\n${falhas} template(s) com problema estrutural.`);
  process.exit(1);
}

console.warn('Templates do chart estruturalmente coerentes.');
console.warn('`helm lint` e `helm template` rodam no CI — esta checagem nao os substitui.');
