import 'server-only';

/**
 * Cliente do plano de controle do Mock Bank.
 *
 * O endereco vem de UMA variavel de ambiente, e nao do `baseUrl` da conexao
 * gravada no banco. A diferenca importa: montar a URL a partir de um campo
 * que um operador edita transformaria esta tela num SSRF — o servidor do
 * console faria requisicao autenticada para qualquer host que alguem
 * digitasse em "URL base". Uma variavel de deploy nao e editavel pela
 * aplicacao, e e por isso que ela e a fonte.
 *
 * Nao ha autenticacao porque `_control` nao tem nenhuma, de proposito: o Mock
 * Bank e um banco FALSO para teste, e nunca deve ser exposto fora da rede do
 * deploy. Isso e responsabilidade da NetworkPolicy do chart, nao desta tela.
 */
const CONTROL = process.env.MOCK_BANK_URL;

export const mockBankEnabled = CONTROL !== undefined;

export class MockBankUnavailable extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!CONTROL) throw new MockBankUnavailable('MOCK_BANK_URL nao esta configurada.');

  let response: Response;
  try {
    response = await fetch(`${CONTROL}/_control${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store',
    });
  } catch (error) {
    // O Mock Bank fora do ar nao pode derrubar a pagina: e um servico de
    // teste, e a tela precisa continuar dizendo POR QUE nao respondeu.
    throw new MockBankUnavailable(error instanceof Error ? error.message : 'Sem resposta.');
  }

  if (!response.ok) {
    throw new MockBankUnavailable(`${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

export const mockBank = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body?: unknown) =>
    call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
};

/** Le sem quebrar a pagina: devolve o motivo em vez de lancar. */
export async function tryGet<T>(path: string): Promise<{ data?: T; error?: string }> {
  try {
    return { data: await mockBank.get<T>(path) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Falha desconhecida.' };
  }
}
