import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  DocumentReceipt,
  DocumentUpload,
  OnboardingCase,
  OnboardingFacet,
  PendingRequirement,
} from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode, RequirementCode } from '@baasconn/taxonomy';

import type { MbDocumentReceipt, MbEnvelope, MbOnboarding } from '../dto/index.js';
import { toOnboardingCase } from '../mappers/onboarding.js';

/**
 * Separador do identificador composto de caso.
 *
 * O Mock Bank so expoe o caso de onboarding PELA CONTA — nao existe rota
 * `GET /onboarding/:id`. Mas o SPI entrega apenas `providerCaseId` para
 * `getStatus`, `listRequirements` e `uploadDocument`.
 *
 * A saida NAO e guardar um indice em memoria: `create(ctx)` roda uma vez por
 * operacao logica, entao um Map dentro do adapter estaria vazio na chamada
 * seguinte e o bug so apareceria sob carga, quando instancias diferentes
 * atendessem a mesma conta.
 *
 * Em vez disso, embutimos a conta no proprio identificador. `providerCaseId` e
 * OPACO para o core por contrato — ele guarda e devolve, nunca interpreta —
 * entao carregar as duas partes ali e legitimo e, o que importa, sem estado.
 * `~` porque nao aparece em ULID nem nos ids do Mock Bank.
 */
const CASE_ID_SEPARATOR = '~';

export function encodeCaseId(accountId: string, caseId: string): string {
  return `${accountId}${CASE_ID_SEPARATOR}${caseId}`;
}

export function decodeCaseId(composite: string): { accountId: string; caseId?: string } {
  const separator = composite.indexOf(CASE_ID_SEPARATOR);
  // Sem separador, tratamos o valor como id de conta: e a unica coisa que o
  // Mock Bank sabe resolver, e devolver um erro de formato aqui seria pior do
  // que tentar.
  if (separator < 0) return { accountId: composite };
  return {
    accountId: composite.slice(0, separator),
    caseId: composite.slice(separator + 1),
  };
}

export function buildOnboardingFacet(client: HttpClient): OnboardingFacet {
  const readByAccount = async (accountId: string): Promise<OnboardingCase> => {
    const response = await client.request<MbEnvelope<MbOnboarding>>({
      method: 'GET',
      path: `/api/v1/contas/${encodeURIComponent(accountId)}/onboarding`,
      endpointClass: 'read',
    });

    if (!response.body.dados) {
      throw new BaasError(BaasErrorCode.RESOURCE_NOT_FOUND, {
        message: `A conta ${accountId} nao possui caso de onboarding.`,
      });
    }

    const mapped = toOnboardingCase(response.body.dados);
    return { ...mapped, providerCaseId: encodeCaseId(accountId, mapped.providerCaseId) };
  };

  return {
    async submitKyc(ref: AccountRef) {
      return readByAccount(ref.providerAccountId);
    },

    async submitKyb(ref: AccountRef) {
      return readByAccount(ref.providerAccountId);
    },

    async getStatus(providerCaseId: string) {
      return readByAccount(decodeCaseId(providerCaseId).accountId);
    },

    async listRequirements(providerCaseId: string): Promise<PendingRequirement[]> {
      const onboarding = await readByAccount(decodeCaseId(providerCaseId).accountId);
      return onboarding.pendingRequirements;
    },

    async uploadDocument(
      providerCaseId: string,
      document: DocumentUpload,
    ): Promise<DocumentReceipt> {
      const { accountId } = decodeCaseId(providerCaseId);

      const response = await client.request<MbDocumentReceipt>({
        method: 'POST',
        path: `/api/v1/contas/${encodeURIComponent(accountId)}/onboarding/documentos`,
        query: { codigo: document.kind },
        // Bytes crus em stream. O sha256 viaja no cabecalho para o provedor
        // recusar upload truncado — sem isso, uma pendencia ficaria "cumprida"
        // com metade de um documento.
        body: document.content(),
        headers: {
          'content-type': document.contentType,
          'x-conteudo-sha256': document.sha256,
        },
        endpointClass: 'upload',
      });

      return {
        providerDocumentId: response.body.documento_id,
        acceptedAt: response.body.onboarding.atualizado_em,
      };
    },

    async fulfillRequirement(
      providerCaseId: string,
      input: { code: string; documentId?: string },
    ): Promise<OnboardingCase> {
      // EMULATED: nao ha rota de cumprimento. A pendencia e cumprida pelo
      // envio do documento, e aqui so relemos o caso — o que mantem o contrato
      // do SPI (devolver o caso atualizado) sem fingir uma chamada.
      if (!(input.code in RequirementCode)) {
        throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
          message: `Pendencia desconhecida: ${input.code}.`,
        });
      }
      return readByAccount(decodeCaseId(providerCaseId).accountId);
    },
  };
}
