import { createServer, type Server } from 'node:http';

export interface ReceivedDelivery {
  headers: Record<string, string>;
  body: string;
}

/**
 * Receptor HTTP de verdade, em porta efemera.
 *
 * Mesma razao do `CassetteServer` na conformidade: interceptar `fetch` testa o
 * mock. Aqui precisamos exercitar a pilha real — cabecalhos, timeout de corpo,
 * `Retry-After`, redirect nao seguido — e nada disso existe num dobro.
 */
export class EndpointServer {
  private server?: Server;
  readonly received: ReceivedDelivery[] = [];
  /** Respostas em fila; esgotada, responde 200. */
  private readonly respostas: Array<{ status: number; headers?: Record<string, string> }> = [];

  responderCom(status: number, headers?: Record<string, string>): this {
    this.respostas.push({ status, headers });
    return this;
  }

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        this.received.push({
          headers: Object.fromEntries(
            Object.entries(request.headers).map(([k, v]) => [k, String(v)]),
          ),
          body: Buffer.concat(chunks).toString('utf8'),
        });

        const proxima = this.respostas.shift() ?? { status: 200 };
        response.writeHead(proxima.status, proxima.headers ?? {}).end('{}');
      });
    });

    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return `http://127.0.0.1:${port}/webhooks`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}
