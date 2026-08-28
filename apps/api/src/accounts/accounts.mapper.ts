import type { AccountDto } from '@baasconn/contracts';
import type { TaxIdType } from '@baasconn/taxonomy';

import type { AccountRecord, HolderRecord } from './accounts.types.js';

/**
 * Monta a resposta canonica de conta.
 *
 * O documento sai MASCARADO por padrao. Desmascarar exige o escopo `pii:read`
 * e gera linha de auditoria no chamador — o valor completo nunca vaza por
 * omissao, so por decisao registrada.
 */
export function toAccountDto(
  account: AccountRecord,
  holder: HolderRecord,
  options: { unmaskedTaxId?: string } = {},
): AccountDto {
  return {
    id: account.id,
    object: 'account',
    holder_id: holder.id,
    holder_type: holder.type,
    holder_tax_id: options.unmaskedTaxId ?? maskedFromLast4(holder.taxIdType, holder.taxIdLast4),
    holder_name: holder.legalName,
    provider: account.provider as AccountDto['provider'],
    connection_id: account.providerConnectionId,
    provider_account_id: account.providerAccountId ?? null,
    external_id: account.externalId ?? null,
    status: account.status,
    status_reason: account.statusReasonCode
      ? {
          code: account.statusReasonCode,
          message: account.statusReasonMessage ?? '',
          at: (account.statusChangedAt ?? account.updatedAt).toISOString(),
        }
      : null,
    kind: account.kind,
    currency: 'BRL',
    bank: account.ispb
      ? {
          ispb: account.ispb,
          branch: account.branch ?? '',
          number: account.number ?? '',
          check_digit: account.checkDigit ?? null,
        }
      : null,
    opened_at: account.openedAt?.toISOString() ?? null,
    closed_at: account.closedAt?.toISOString() ?? null,
    metadata: account.metadata,
    created_at: account.createdAt.toISOString(),
    updated_at: account.updatedAt.toISOString(),
  };
}

/**
 * Mascara a partir dos quatro ultimos digitos.
 *
 * O documento completo esta cifrado; reconstruir a mascara exigiria decifrar,
 * e decifrar para MOSTRAR MENOS seria gastar uma operacao de KMS por linha de
 * listagem. Os quatro ultimos ficam em claro exatamente para isto, e sao o que
 * o suporte usa para confirmar identidade ao telefone.
 *
 * Preserva QUATRO digitos, enquanto `maskTaxId` preserva cinco. A diferenca e
 * consequencia do que a tabela guarda, e ela erra para o lado seguro.
 */
function maskedFromLast4(type: TaxIdType, last4: string): string {
  const digits = last4.padStart(4, '0');
  const head = digits.slice(0, 2);
  const check = digits.slice(2);
  // Os dois ultimos digitos sao sempre o verificador, nos dois formatos.
  return type === 'CNPJ' ? `**.***.***/**${head}-${check}` : `***.***.*${head}-${check}`;
}
