/**
 * Ponto de entrada de instrumentacao.
 *
 * Precisa ser a PRIMEIRA linha de todo `main.ts`, antes de qualquer outro
 * import: o OpenTelemetry instrumenta `http`, `pg` e `ioredis` por
 * monkey-patch, e se o Nest carregar esses modulos antes, o patch nao pega
 * nada e os traces ficam vazios sem erro nenhum.
 *
 * O SDK de OTel so e carregado quando ha endpoint configurado, para o
 * `docker compose up` de quem so quer ver o conector rodar nao arrastar o
 * runtime de tracing.
 */
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
   
  console.warn(`[observability] OpenTelemetry habilitado, exportando para ${endpoint}`);
} else {
   
  console.warn('[observability] OTEL_EXPORTER_OTLP_ENDPOINT ausente; tracing desabilitado');
}

export {};
