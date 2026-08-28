/**
 * Ambiente de execucao. Dimensao de primeira classe: toda tabela de negocio,
 * toda conexao de provedor e toda API key sao ligadas a exatamente um.
 *
 * O enum e em ingles porque a API canonica e em ingles; o console renderiza
 * "Homologacao" e "Producao".
 */
export enum Environment {
  HOMOLOGACAO = 'HOMOLOGACAO',
  PRODUCAO = 'PRODUCAO',
}

export enum ProviderSlug {
  CELCOIN = 'CELCOIN',
  QITECH = 'QITECH',
  DOCK = 'DOCK',
  ASAAS = 'ASAAS',
  WOOVI = 'WOOVI',
  MOCK_BANK = 'MOCK_BANK',
}

/** Pessoa Fisica / Pessoa Juridica. */
export enum HolderType {
  INDIVIDUAL = 'INDIVIDUAL',
  BUSINESS = 'BUSINESS',
}

export enum TaxIdType {
  CPF = 'CPF',
  CNPJ = 'CNPJ',
}

export enum RiskRating {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  PROHIBITED = 'PROHIBITED',
}

export enum BrazilianState {
  AC = 'AC',
  AL = 'AL',
  AP = 'AP',
  AM = 'AM',
  BA = 'BA',
  CE = 'CE',
  DF = 'DF',
  ES = 'ES',
  GO = 'GO',
  MA = 'MA',
  MT = 'MT',
  MS = 'MS',
  MG = 'MG',
  PA = 'PA',
  PB = 'PB',
  PR = 'PR',
  PE = 'PE',
  PI = 'PI',
  RJ = 'RJ',
  RN = 'RN',
  RS = 'RS',
  RO = 'RO',
  RR = 'RR',
  SC = 'SC',
  SP = 'SP',
  SE = 'SE',
  TO = 'TO',
}

export enum AddressType {
  RESIDENTIAL = 'RESIDENTIAL',
  COMMERCIAL = 'COMMERCIAL',
  MAILING = 'MAILING',
}

export enum MaritalStatus {
  SINGLE = 'SINGLE',
  MARRIED = 'MARRIED',
  DIVORCED = 'DIVORCED',
  WIDOWED = 'WIDOWED',
  STABLE_UNION = 'STABLE_UNION',
}

export enum IdentityDocumentKind {
  RG = 'RG',
  CNH = 'CNH',
  RNE = 'RNE',
  PASSPORT = 'PASSPORT',
  CTPS = 'CTPS',
}

export enum CompanySize {
  MEI = 'MEI',
  ME = 'ME',
  EPP = 'EPP',
  MEDIUM = 'MEDIUM',
  LARGE = 'LARGE',
}

/** Papel do representante legal de uma PJ. */
export enum RepresentativeRole {
  PARTNER = 'PARTNER',
  ADMINISTRATOR = 'ADMINISTRATOR',
  DIRECTOR = 'DIRECTOR',
  ATTORNEY = 'ATTORNEY',
  LEGAL_GUARDIAN = 'LEGAL_GUARDIAN',
}

/** De onde veio uma mudanca de estado. Essencial para auditoria e depuracao. */
export enum ChangeSource {
  API = 'API',
  PROVIDER_WEBHOOK = 'PROVIDER_WEBHOOK',
  POLLING = 'POLLING',
  RECONCILIATION = 'RECONCILIATION',
  MANUAL = 'MANUAL',
  SYSTEM = 'SYSTEM',
}

export enum ActorType {
  API_KEY = 'API_KEY',
  USER = 'USER',
  SYSTEM = 'SYSTEM',
  PROVIDER = 'PROVIDER',
}
