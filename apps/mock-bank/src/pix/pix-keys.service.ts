import {
  inferPixKeyType,
  isValidPixKey,
  newId,
  normalizePixKey,
  PixKeyStatus,
  PixKeyType,
} from '@baasconn/taxonomy';
import { Injectable } from '@nestjs/common';

import { AccountsService } from '../accounts/accounts.service.js';
import { MockClock } from '../common/clock.provider.js';
import { MockBankError } from '../common/errors.js';
import { MockBankStore, MockPixKey } from '../common/store.js';

/** DICT do Mock Bank: registro de chaves e resolucao de terceiros. */
@Injectable()
export class PixKeysService {
  constructor(
    private readonly store: MockBankStore,
    private readonly accounts: AccountsService,
    private readonly clock: MockClock,
  ) {}

  create(accountId: string, type: PixKeyType, value?: string): MockPixKey {
    const account = this.accounts.get(accountId);

    // EVP e gerada pelo PSP; as demais o titular informa.
    const raw = type === PixKeyType.EVP ? crypto.randomUUID() : value;
    if (!raw) {
      throw new MockBankError(
        'MB-DICT-422',
        'value e obrigatorio para chaves que nao sao EVP.',
        422 as never,
      );
    }
    if (!isValidPixKey(type, raw)) {
      throw new MockBankError(
        'MB-DICT-422',
        `Chave Pix invalida para o tipo ${type}.`,
        422 as never,
      );
    }

    const normalized = normalizePixKey(type, raw);
    if (this.store.pixKeysByValue.has(normalized)) throw MockBankError.pixKeyExists();

    const key: MockPixKey = {
      id: newId('pixKey'),
      accountId: account.id,
      type,
      value: normalized,
      status: PixKeyStatus.ACTIVE,
      createdAt: this.clock.now(),
    };

    this.store.pixKeys.set(key.id, key);
    this.store.pixKeysByValue.set(normalized, key.id);
    return key;
  }

  list(accountId: string): MockPixKey[] {
    return [...this.store.pixKeys.values()].filter(
      (key) => key.accountId === accountId && key.status !== PixKeyStatus.REMOVED,
    );
  }

  remove(accountId: string, value: string): void {
    const key = this.findActive(value);
    if (!key || key.accountId !== accountId) throw MockBankError.pixKeyNotFound(value);
    key.status = PixKeyStatus.REMOVED;
    this.store.pixKeysByValue.delete(key.value);
  }

  findActive(value: string): MockPixKey | undefined {
    const type = inferPixKeyType(value);
    if (!type) return undefined;
    const normalized = normalizePixKey(type, value);
    const id = this.store.pixKeysByValue.get(normalized);
    return id ? this.store.pixKeys.get(id) : undefined;
  }

  /**
   * Resolucao DICT.
   *
   * Chave desconhecida devolve 404, e nao uma conta generica: o conector
   * precisa aprender a tratar chave inexistente, que e o erro mais comum de
   * PIX out na vida real.
   */
  resolve(value: string): {
    key: MockPixKey;
    holderName: string;
    holderTaxId: string;
    ispb: string;
    branch: string;
    accountNumber: string;
  } {
    const key = this.findActive(value);
    if (!key) throw MockBankError.pixKeyNotFound(value);
    const account = this.accounts.get(key.accountId);
    return {
      key,
      holderName: account.holderName,
      holderTaxId: account.holderTaxId,
      ispb: account.ispb,
      branch: account.branch,
      accountNumber: account.number,
    };
  }
}
