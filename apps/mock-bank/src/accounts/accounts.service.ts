import {
  AccountStatus,
  HolderType,
  isValidCnpj,
  isValidCpf,
  newId,
  onlyDigits,
  TaxIdType,
} from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import { MockClock } from '../common/clock.provider.js';
import { MockBankError } from '../common/errors.js';
import { MockBankStore, MockAccount } from '../common/store.js';
import { MockBankConfig } from '../config/config.service.js';
import { LedgerService } from '../ledger/ledger.service.js';

export interface CreateAccountInput {
  clientId: string;
  holderType: HolderType;
  holderTaxId: string;
  holderName: string;
  email: string;
  externalId?: string;
  raw?: Record<string, unknown>;
}

@Injectable()
export class AccountsService {
  private accountSequence = 0;

  constructor(
    private readonly store: MockBankStore,
    private readonly ledger: LedgerService,
    private readonly clock: MockClock,
    private readonly config: MockBankConfig,
  ) {}

  create(input: CreateAccountInput): MockAccount {
    const taxId = onlyDigits(input.holderTaxId);
    const valid =
      input.holderType === HolderType.INDIVIDUAL ? isValidCpf(taxId) : isValidCnpj(taxId);
    if (!valid) throw MockBankError.invalidTaxId();

    // Deduplicacao por documento: criar duas contas para o mesmo CPF e
    // incidente de compliance, entao o provedor devolve a existente.
    const existingId = this.store.accountsByTaxId.get(`${input.clientId}:${taxId}`);
    if (existingId) return this.store.accounts.get(existingId)!;

    if (input.externalId) {
      const byExternal = this.store.accountsByExternalId.get(
        `${input.clientId}:${input.externalId}`,
      );
      if (byExternal) return this.store.accounts.get(byExternal)!;
    }

    const id = newId('account');
    const { availableId, blockedId } = this.ledger.openCustomerAccounts(id);
    this.accountSequence += 1;

    const number = (1_000_000 + this.accountSequence).toString();
    const account: MockAccount = {
      id,
      clientId: input.clientId,
      holderType: input.holderType,
      holderTaxId: taxId,
      holderName: input.holderName,
      email: input.email,
      status: AccountStatus.PENDING_ONBOARDING,
      branch: this.config.branch,
      number,
      checkDigit: this.checkDigit(number),
      ispb: this.config.ispb,
      externalId: input.externalId,
      availableLedgerAccountId: availableId,
      blockedLedgerAccountId: blockedId,
      createdAt: this.clock.now(),
      raw: input.raw ?? {},
    };

    this.store.accounts.set(id, account);
    this.store.accountsByTaxId.set(`${input.clientId}:${taxId}`, id);
    if (input.externalId) {
      this.store.accountsByExternalId.set(`${input.clientId}:${input.externalId}`, id);
    }
    return account;
  }

  get(id: string): MockAccount {
    const account = this.store.accounts.get(id);
    if (!account) throw MockBankError.accountNotFound(id);
    return account;
  }

  list(clientId: string): MockAccount[] {
    return [...this.store.accounts.values()].filter((a) => a.clientId === clientId);
  }

  /** Ativa a conta apos o onboarding aprovar. */
  activate(id: string, openBlocked: boolean): MockAccount {
    const account = this.get(id);
    account.status = openBlocked ? AccountStatus.BLOCKED : AccountStatus.ACTIVE;
    account.openedAt = this.clock.now();
    return account;
  }

  reject(id: string): MockAccount {
    const account = this.get(id);
    account.status = AccountStatus.REJECTED;
    return account;
  }

  setStatus(id: string, status: AccountStatus): MockAccount {
    const account = this.get(id);
    account.status = status;
    return account;
  }

  /** So conta ativa movimenta. Bloqueada e suspensa recusam com o motivo. */
  assertCanTransact(account: MockAccount): void {
    if (account.status !== AccountStatus.ACTIVE) {
      throw MockBankError.accountNotActive(account.status);
    }
  }

  balances(id: string): { available: bigint; blocked: bigint; pending: bigint } {
    const account = this.get(id);
    const available = this.ledger.balances(account.availableLedgerAccountId);
    const blocked = this.ledger.balances(account.blockedLedgerAccountId);
    return {
      available: available.available,
      blocked: blocked.posted,
      pending: available.pending,
    };
  }

  taxIdType(account: MockAccount): TaxIdType {
    return account.holderType === HolderType.INDIVIDUAL ? TaxIdType.CPF : TaxIdType.CNPJ;
  }

  /** Digito verificador simples, so para o numero parecer real. */
  private checkDigit(number: string): string {
    const sum = [...number].reduce((acc, digit, i) => acc + Number(digit) * (i + 2), 0);
    return String(sum % 10);
  }
}
