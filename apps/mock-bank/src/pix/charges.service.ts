import { buildBrCode, Money, PixChargeStatus } from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import { AccountsService } from '../accounts/accounts.service.js';
import { MockClock } from '../common/clock.provider.js';
import { MockBankError } from '../common/errors.js';
import { MockBankStore, MockCharge } from '../common/store.js';

import { PixKeysService } from './pix-keys.service.js';

export interface CreateChargeInput {
  accountId: string;
  kind: 'static' | 'dynamic';
  pixKey: string;
  amountCents?: bigint;
  txid?: string;
  expiresInSeconds?: number;
  payerRequest?: string;
}

@Injectable()
export class ChargesService {
  private sequence = 0;

  constructor(
    private readonly store: MockBankStore,
    private readonly accounts: AccountsService,
    private readonly keys: PixKeysService,
    private readonly clock: MockClock,
  ) {}

  create(input: CreateChargeInput): MockCharge {
    const account = this.accounts.get(input.accountId);
    const key = this.keys.findActive(input.pixKey);
    if (!key || key.accountId !== account.id) throw MockBankError.pixKeyNotFound(input.pixKey);

    const txid = input.txid ?? this.generateTxid(input.kind);
    if (this.store.charges.has(txid)) {
      throw new MockBankError('MB-COB-409', `Cobranca com txid ${txid} ja existe.`, 409 as never);
    }

    const now = this.clock.now();
    const expiresAt =
      input.kind === 'dynamic'
        ? new Date(now.getTime() + (input.expiresInSeconds ?? 3600) * 1000)
        : undefined;

    // O payload EMV e gerado pelo codec canonico, o mesmo que o conector usa
    // para parsear. Se os dois divergirem, o teste pega.
    const emvPayload = buildBrCode({
      pixKey: key.value,
      merchantName: account.holderName,
      merchantCity: 'SAO PAULO',
      amount: input.amountCents ? Money.of(input.amountCents).toDecimalString() : undefined,
      referenceLabel: txid,
      payerRequest: input.payerRequest,
    } as never);

    const charge: MockCharge = {
      txid,
      accountId: account.id,
      kind: input.kind,
      status: PixChargeStatus.ACTIVE,
      amountCents: input.amountCents,
      pixKey: key.value,
      emvPayload,
      expiresAt,
      paidAmountCents: 0n,
      paidTransactionIds: [],
      revision: 0,
      createdAt: now,
    };

    this.store.charges.set(txid, charge);
    return charge;
  }

  get(txid: string): MockCharge {
    const charge = this.store.charges.get(txid);
    if (!charge) throw MockBankError.chargeNotFound(txid);
    this.expireIfDue(charge);
    return charge;
  }

  list(accountId: string): MockCharge[] {
    return [...this.store.charges.values()]
      .filter((charge) => charge.accountId === accountId)
      .map((charge) => {
        this.expireIfDue(charge);
        return charge;
      });
  }

  cancel(txid: string): MockCharge {
    const charge = this.get(txid);
    if (charge.status !== PixChargeStatus.ACTIVE) {
      throw new MockBankError(
        'MB-COB-422',
        `Cobranca ${charge.status} nao pode ser cancelada.`,
        422 as never,
      );
    }
    charge.status = PixChargeStatus.REMOVED_BY_USER;
    charge.revision += 1;
    return charge;
  }

  markPaid(txid: string, amountCents: bigint, transactionId: string): MockCharge {
    const charge = this.get(txid);
    charge.paidAmountCents += amountCents;
    charge.paidTransactionIds.push(transactionId);
    charge.paidAt = this.clock.now();
    // Cobranca de valor aberto aceita qualquer valor; com valor definido, so
    // conclui quando o total for atingido.
    if (!charge.amountCents || charge.paidAmountCents >= charge.amountCents) {
      charge.status = PixChargeStatus.COMPLETED;
    }
    charge.revision += 1;
    return charge;
  }

  private expireIfDue(charge: MockCharge): void {
    if (charge.status !== PixChargeStatus.ACTIVE) return;
    if (!charge.expiresAt) return;
    if (this.clock.now() < charge.expiresAt) return;
    charge.status = PixChargeStatus.EXPIRED;
    charge.revision += 1;
  }

  private generateTxid(kind: 'static' | 'dynamic'): string {
    this.sequence += 1;
    const suffix = this.sequence.toString().padStart(8, '0');
    // Dinamica exige 26 a 35 alfanumericos; estatica aceita ate 25.
    return kind === 'dynamic' ? `MOCKBANKDYN${suffix}${'0'.repeat(7)}` : `MOCKSTATIC${suffix}`;
  }
}
