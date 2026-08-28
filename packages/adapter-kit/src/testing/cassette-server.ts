import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Servidor HTTP real que reproduz respostas gravadas.
 *
 * Servidor de verdade e nao nock/MSW de proposito: interceptacao mocka
 * exatamente a camada que mais queremos testar (timeout, reuso de conexao,
 * Retry-After, streaming) e amarra o teste a biblioteca HTTP que o adapter
 * usa por dentro. Com servidor real, o teste vale igual seja o adapter escrito
 * com undici, axios ou fetch puro.
 */

export interface CassetteInteraction {
  request: {
    method: string;
    /** Caminho, com ou sem query. Query e comparada quando presente. */
    path: string;
    /** sha256 do corpo canonicalizado. Ausente ignora o corpo. */
    bodyHash?: string;
    headers?: Record<string, string>;
  };
  response: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
    /** Atraso simulado, para exercitar timeout. */
    delayMs?: number;
  };
  /** Quantas vezes esta interacao pode ser servida. Padrao: ilimitado. */
  maxUses?: number;
}

export interface Cassette {
  provider: string;
  scenario: string;
  /** Distingue comportamento verificado de fixture escrita a partir da doc. */
  source: 'sandbox' | 'handcrafted-from-docs';
  recordedAt?: string;
  docsRef?: string;
  interactions: CassetteInteraction[];
}

export interface CassetteServerOptions {
  cassettes: readonly Cassette[];
  /** Resposta quando nenhuma interacao casa. Padrao: 404 com diagnostico. */
  onUnmatched?: (request: { method: string; path: string; body: string }) => {
    status: number;
    body: unknown;
  };
}

export function canonicalBodyHash(body: unknown): string {
  const normalized = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  matched: boolean;
}

export class CassetteServer {
  private server?: Server;
  private readonly uses = new Map<CassetteInteraction, number>();
  private readonly calls: RecordedCall[] = [];

  constructor(private readonly options: CassetteServerOptions) {}

  get baseUrl(): string {
    const address = this.server?.address() as AddressInfo | null;
    if (!address) throw new Error('CassetteServer nao esta escutando');
    return `http://127.0.0.1:${address.port}`;
  }

  /** Chamadas recebidas, para o teste afirmar o que o adapter enviou. */
  get received(): readonly RecordedCall[] {
    return this.calls;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((error) => (error ? reject(error) : resolve())),
    );
    this.server = undefined;
  }

  reset(): void {
    this.uses.clear();
    this.calls.length = 0;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const path = req.url ?? '/';
    const method = req.method ?? 'GET';

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }

    const interaction = this.match(method, path, body);
    this.calls.push({ method, path, headers, body, matched: Boolean(interaction) });

    if (!interaction) {
      const fallback = this.options.onUnmatched?.({ method, path, body }) ?? {
        status: 404,
        body: {
          error: 'cassette_no_match',
          message: `Nenhuma interacao gravada casa com ${method} ${path}`,
          received_body_hash: canonicalBodyHash(body),
        },
      };
      res.writeHead(fallback.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fallback.body));
      return;
    }

    this.uses.set(interaction, (this.uses.get(interaction) ?? 0) + 1);

    if (interaction.response.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, interaction.response.delayMs));
    }

    res.writeHead(interaction.response.status, {
      'content-type': 'application/json',
      ...interaction.response.headers,
    });
    res.end(
      interaction.response.body === undefined ? '' : JSON.stringify(interaction.response.body),
    );
  }

  private match(method: string, path: string, body: string): CassetteInteraction | undefined {
    const pathname = path.split('?')[0] ?? path;

    for (const cassette of this.options.cassettes) {
      for (const interaction of cassette.interactions) {
        if (interaction.request.method.toUpperCase() !== method.toUpperCase()) continue;

        const expected = interaction.request.path;
        const expectedPath = expected.split('?')[0] ?? expected;
        if (expectedPath !== pathname) continue;
        // Query so e comparada quando a fixture a declara.
        if (expected.includes('?') && expected !== path) continue;

        if (interaction.request.bodyHash) {
          let hash = canonicalBodyHash(body);
          if (hash !== interaction.request.bodyHash) {
            // Reserializa para tolerar diferenca de ordem de chave no JSON.
            try {
              hash = canonicalBodyHash(JSON.parse(body));
            } catch {
              continue;
            }
            if (hash !== interaction.request.bodyHash) continue;
          }
        }

        const used = this.uses.get(interaction) ?? 0;
        if (interaction.maxUses !== undefined && used >= interaction.maxUses) continue;

        return interaction;
      }
    }

    return undefined;
  }
}

/** Sobe um servidor, roda o teste e desliga. */
export async function withCassettes<T>(
  cassettes: readonly Cassette[],
  fn: (baseUrl: string, server: CassetteServer) => Promise<T>,
): Promise<T> {
  const server = new CassetteServer({ cassettes });
  const baseUrl = await server.start();
  try {
    return await fn(baseUrl, server);
  } finally {
    await server.stop();
  }
}
