import { createServer, type Server } from 'node:http';

import type { Metrics } from './metrics.js';

/**
 * Listener de metricas, em porta separada.
 *
 * `/metrics` no listener publico e vazamento (nomes de conexao, volumes,
 * cardinalidade de conta) e vetor de DoS barato: cada raspagem serializa o
 * registro inteiro. A porta dedicada fica atras da NetworkPolicy, alcancavel
 * so pelo Prometheus.
 *
 * Vive aqui, e nao em cada app, porque API e worker expoem o mesmo endpoint
 * pelo mesmo motivo — e duplicar o listener seria duplicar a decisao, que e a
 * forma como as duas copias divergem.
 */
export async function startMetricsServer(
  metrics: Metrics,
  port: number,
  onListening?: (url: string) => void,
): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    void metrics
      .render()
      .then((body) => {
        response.writeHead(200, { 'Content-Type': metrics.contentType }).end(body);
      })
      .catch(() => response.writeHead(500).end());
  });

  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));
  onListening?.(`http://0.0.0.0:${port}/metrics`);
  return server;
}
