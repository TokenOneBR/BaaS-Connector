/**
 * Formas de wire da Woovi.
 *
 * Escritas a partir da documentacao publica em developers.woovi.com.
 * `handcrafted-from-docs`, nao gravadas contra sandbox.
 */
export interface WvCharge {
  correlationID: string;
  status?: string;
  /** Centavos INTEIROS. A Woovi e o unico dos cinco que ja fala centavos. */
  value: number;
  comment?: string;
  brCode: string;
  qrCodeImage?: string;
  paymentLinkUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresDate?: string;
  expiresIn?: number;
}

export interface WvChargeResponse {
  charge: WvCharge;
  correlationID?: string;
  brCode?: string;
}

export interface WvChargeList {
  charges?: WvCharge[];
  pageInfo?: { skip?: number; limit?: number; totalCount?: number; hasNextPage?: boolean };
}
