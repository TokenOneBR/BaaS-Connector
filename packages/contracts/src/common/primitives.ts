import {
  AddressType,
  BrazilianState,
  CURRENCY_SCALE,
  Environment,
  isValidCnpj,
  isValidCpf,
  isValidEmail,
  isValidPostalCode,
  onlyDigits,
  parsePhone,
  ProviderSlug,
  TaxIdType,
} from '@baasconn/taxonomy';
import { z } from 'zod';

/** Cria um schema Zod a partir de um enum TypeScript, preservando os literais. */
export function zEnum<T extends Record<string, string>>(source: T) {
  return z.enum(Object.values(source) as [string, ...string[]]) as unknown as z.ZodType<T[keyof T]>;
}

export const zEnvironment = zEnum(Environment);
export const zProviderSlug = zEnum(ProviderSlug);
export const zBrazilianState = zEnum(BrazilianState);
export const zAddressType = zEnum(AddressType);

/**
 * Dinheiro no wire.
 *
 * `amount` sao unidades menores (centavos) como string, com `scale`
 * auto-descritiva. Nunca um decimal: decimal convida `parseFloat` em todo
 * consumidor e perde centavo.
 */
export const zMoney = z
  .object({
    amount: z.string().regex(/^-?\d{1,19}$/, 'amount deve ser um inteiro em unidades menores'),
    currency: z.literal('BRL'),
    scale: z.number().int(),
  })
  .refine((m) => m.scale === CURRENCY_SCALE[m.currency], {
    message: 'scale incompativel com a moeda',
    path: ['scale'],
  });

export type MoneyDto = z.infer<typeof zMoney>;

/** Valor apenas positivo, para campos que nunca aceitam credito negativo. */
export const zPositiveMoney = zMoney.refine((m) => BigInt(m.amount) > 0n, {
  message: 'O valor deve ser maior que zero',
  path: ['amount'],
});

export const zTaxId = z
  .object({
    type: zEnum(TaxIdType),
    value: z.string().transform(onlyDigits),
  })
  .refine((t) => (t.type === TaxIdType.CPF ? isValidCpf(t.value) : isValidCnpj(t.value)), {
    message: 'CPF ou CNPJ com digito verificador invalido',
    path: ['value'],
  });

export type TaxIdDto = z.infer<typeof zTaxId>;

export const zPhone = z
  .object({
    country_code: z.string().default('55'),
    area_code: z.string().length(2),
    number: z.string().min(8).max(9),
  })
  .refine((p) => parsePhone(`${p.area_code}${p.number}`, p.country_code) !== undefined, {
    message: 'Telefone brasileiro invalido',
  });

export const zEmail = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .refine(isValidEmail, {
    message: 'Email invalido',
  });

export const zAddress = z.object({
  type: zAddressType.default(AddressType.RESIDENTIAL),
  postal_code: z.string().transform(onlyDigits).refine(isValidPostalCode, {
    message: 'CEP deve ter 8 digitos',
  }),
  street: z.string().min(1).max(255),
  number: z.string().min(1).max(16),
  complement: z.string().max(128).optional(),
  district: z.string().min(1).max(128),
  city: z.string().min(1).max(128),
  state: zBrazilianState,
  country: z.literal('BR').default('BR'),
  ibge_city_code: z
    .string()
    .regex(/^\d{7}$/)
    .optional(),
});

export type AddressDto = z.infer<typeof zAddress>;

/** RFC 3339 com offset. Rejeita data sem fuso, que e ambigua. */
export const zTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
    'Use RFC 3339 com offset explicito',
  );

/** Data contabil no fuso de Brasilia. */
export const zEffectiveDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD');

export const zMetadata = z.record(z.string().max(64), z.string().max(512)).default({});

/** Identificador do cliente, unico por ambiente e por recurso. */
export const zExternalId = z.string().min(1).max(128);

export const zIdempotencyKey = z
  .string()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9_\-:.]+$/, 'Use apenas letras, digitos e os caracteres _-:.');
