/** Formas de wire do Asaas. `handcrafted-from-docs`. */
export interface AsPixKey {
  id: string;
  key: string;
  type: string;
  status: string;
  dateCreated?: string;
  qrCode?: { encodedImage?: string; payload?: string };
}

export interface AsPixKeyList {
  data?: AsPixKey[];
  hasMore?: boolean;
  limit?: number;
  offset?: number;
  totalCount?: number;
}

export interface AsBalance {
  /** Decimal em NUMERO JSON, como a Celcoin. */
  balance: number;
}

export interface AsError {
  errors?: Array<{ code?: string; description?: string }>;
}
