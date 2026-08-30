import type { HttpClient } from '@baasconn/adapter-kit';
import type {
  AccountRef,
  AccountsFacet,
  CreateAccountPFInput,
  AddressInput,
  CreateAccountPJInput,
  Page,
  ProviderAccount,
} from '@baasconn/provider-spi';
import { BaasError, BaasErrorCode } from '@baasconn/taxonomy';

import type { CcAccount, CcEnvelope } from '../dto/index.js';
import { paths } from '../endpoints.js';
import { toProviderAccount } from '../mappers/account.js';

export function buildAccountsFacet(client: HttpClient): AccountsFacet {
  const create = async (path: string, body: unknown): Promise<ProviderAccount> => {
    const response = await client.request<CcEnvelope<CcAccount>>({
      method: 'POST',
      path,
      body,
      // O `clientCode` no corpo E a chave de idempotencia da Celcoin — nao ha
      // header. Por isso `idempotency.accounts.create` e `mode: 'external_id'`
      // no factory: o conector manda o mesmo codigo no retry.
      idempotent: false,
      endpointClass: 'write',
    });
    return toProviderAccount(response.body.body);
  };

  return {
    createPF: (input: CreateAccountPFInput) =>
      create(paths.accountPf, {
        clientCode: input.externalId,
        documentNumber: input.holder.taxId.value,
        phoneNumber: `${input.holder.phone.areaCode}${input.holder.phone.number}`,
        email: input.holder.email,
        motherName: input.holder.motherName,
        fullName: input.holder.fullName,
        birthDate: input.holder.birthDate,
        address: addressOf(input.holder.addresses[0]),
      }),

    createPJ: (input: CreateAccountPJInput) =>
      create(paths.accountPj, {
        clientCode: input.externalId,
        documentNumber: input.company.taxId.value,
        contactNumber: `${input.company.phone.areaCode}${input.company.phone.number}`,
        businessEmail: input.company.email,
        businessName: input.company.legalName,
        tradingName: input.company.tradeName,
        businessOpeningDate: input.company.incorporationDate,
        businessAddress: addressOf(input.company.addresses[0]),
        owner: input.representatives.map((rep) => ({
          documentNumber: rep.taxId.value,
          fullName: rep.fullName,
          phoneNumber: rep.phone ? `${rep.phone.areaCode}${rep.phone.number}` : undefined,
          email: rep.email,
          motherName: rep.motherName,
          birthDate: rep.birthDate,
          address: addressOf(rep.address),
        })),
      }),

    async get(ref: AccountRef): Promise<ProviderAccount> {
      const response = await client.request<CcEnvelope<CcAccount>>({
        method: 'GET',
        path: '/baas/v2/account',
        query: { Account: ref.providerAccountId },
        endpointClass: 'read',
      });
      return toProviderAccount(response.body.body);
    },

    // Declaradas UNSUPPORTED no manifesto: o guard do conector devolve 501 com
    // a nota ANTES de chegar aqui. Estes lancam porque a suite de conformidade
    // exige que declarado-como-nao-suportado lance exatamente este erro, e nao
    // um TypeError de metodo ausente.
    list: () => unsupported<Page<ProviderAccount>>('accounts.list'),
    updateStatus: () => unsupported<ProviderAccount>('accounts.updateStatus'),
    close: () => unsupported<ProviderAccount>('accounts.close'),
  };
}

function unsupported<T>(capability: string): Promise<T> {
  return Promise.reject(
    new BaasError(BaasErrorCode.CAPABILITY_NOT_SUPPORTED, {
      message: `A Celcoin nao expoe ${capability} na documentacao publica consultada.`,
    }),
  );
}

function addressOf(address: AddressInput | undefined) {
  if (!address) return undefined;
  return {
    postalCode: address.postalCode,
    street: address.street,
    number: address.number,
    addressComplement: address.complement,
    neighborhood: address.district,
    city: address.city,
    state: address.state,
  };
}
