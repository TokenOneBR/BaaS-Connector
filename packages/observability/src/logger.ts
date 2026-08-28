import pino, { type Logger, type LoggerOptions, type DestinationStream } from 'pino';

/**
 * Nomes de campo redigidos em QUALQUER profundidade.
 *
 * A opcao `redact.paths` do pino nao serve aqui: `*.cpf` casa exatamente UM
 * nivel de aninhamento, entao deixa passar `{ cpf }` no topo e
 * `{ a: { b: { cpf } } }` embaixo. Num payload de provedor, que e aninhado e
 * de forma imprevisivel, isso e uma lacuna real. Usamos um formatter que
 * percorre o objeto por NOME DE CHAVE.
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'cpf',
  'cnpj',
  'taxid',
  'tax_id',
  'documento',
  'document',
  'documentnumber',
  'document_number',
  'password',
  'senha',
  'secret',
  'clientsecret',
  'client_secret',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'authorization',
  'cookie',
  'set-cookie',
  'cardnumber',
  'card_number',
  'cvv',
  'mothername',
  'mother_name',
  'nomemae',
  'birthdate',
  'birth_date',
  'datanascimento',
  'email',
  'phone',
  'phonenumber',
  'phone_number',
  'telefone',
  'pixkey',
  'pix_key',
  'chave',
  'accountnumber',
  'account_number',
  'credentials',
  'credenciais',
  'signingsecret',
  'webhooksecret',
]);

/** Chaves cujo VALOR INTEIRO some, em vez de virar mascara. */
export const DROPPED_KEYS: ReadonlySet<string> = new Set([
  'filecontent',
  'file_content',
  'base64',
  'imagebase64',
  'qrcodebase64',
  'rawbody',
]);

export const CENSOR = '[REDACTED]';

/** Profundidade maxima da travessia, para um objeto ciclico nao travar o log. */
const MAX_DEPTH = 12;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !(value instanceof Date);
}

/**
 * Mascara preservando o final.
 *
 * Os ultimos digitos ficam visiveis de proposito: e o que permite ao suporte
 * confirmar de qual documento se trata sem ver o documento.
 */
export function maskSensitive(value: unknown): string {
  if (typeof value !== 'string') return CENSOR;

  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
  }

  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) {
    return `${value.slice(0, -6).replace(/\d/g, '*')}${value.slice(-6)}`;
  }

  if (value.length <= 6) return CENSOR;
  return `${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}

/** Percorre e redige por nome de chave, em qualquer profundidade. */
export function deepRedact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (!isPlainObject(value)) return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (DROPPED_KEYS.has(normalized)) continue;
    if (SENSITIVE_KEYS.has(normalized)) {
      out[key] = isPlainObject(child) ? CENSOR : maskSensitive(child);
      continue;
    }
    out[key] = deepRedact(child, depth + 1, seen);
  }
  return out;
}

export interface LoggerConfig {
  level?: string;
  pretty?: boolean;
  service: string;
  environment?: string;
  version?: string;
  /** Injetavel para teste; padrao e stdout. */
  destination?: DestinationStream;
}

export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level ?? process.env.LOG_LEVEL ?? 'info',
    base: {
      service: config.service,
      environment: config.environment,
      version: config.version,
    },
    formatters: {
      level: (label) => ({ level: label }),
      // O formatter roda em TODA linha, entao nenhum caminho de log escapa.
      log: (object) => deepRedact(object) as Record<string, unknown>,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (config.destination) return pino(options, config.destination);

  if (config.pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l' },
      },
    });
  }

  return pino(options);
}
