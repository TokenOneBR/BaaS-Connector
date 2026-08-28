import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Erro no formato do Mock Bank.
 *
 * O formato imita o de um BaaS real (codigo proprio, mensagem em portugues),
 * de proposito: e o que o adapter precisa aprender a mapear.
 */
export class MockBankError extends HttpException {
  constructor(
    readonly errorCode: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super({ error: { code: errorCode, message, details } }, status);
  }

  static insufficientFunds(availableCents: bigint): MockBankError {
    return new MockBankError(
      'MB-SALDO-001',
      'Saldo insuficiente para a operacao.',
      HttpStatus.BAD_REQUEST,
      {
        available_cents: availableCents.toString(),
      },
    );
  }

  static accountNotFound(id: string): MockBankError {
    return new MockBankError('MB-CONTA-404', `Conta ${id} nao encontrada.`, HttpStatus.NOT_FOUND);
  }

  static accountNotActive(status: string): MockBankError {
    return new MockBankError(
      'MB-CONTA-002',
      `Conta com status ${status} nao pode movimentar.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  static invalidTaxId(): MockBankError {
    return new MockBankError(
      'MB-DOC-001',
      'CPF ou CNPJ invalido.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  static pixKeyNotFound(key: string): MockBankError {
    return new MockBankError(
      'MB-DICT-404',
      `Chave Pix ${key} nao encontrada no DICT.`,
      HttpStatus.NOT_FOUND,
    );
  }

  static pixKeyExists(): MockBankError {
    return new MockBankError('MB-DICT-409', 'Chave Pix ja cadastrada.', HttpStatus.CONFLICT);
  }

  static transactionNotFound(id: string): MockBankError {
    return new MockBankError('MB-TX-404', `Transacao ${id} nao encontrada.`, HttpStatus.NOT_FOUND);
  }

  static chargeNotFound(txid: string): MockBankError {
    return new MockBankError(
      'MB-COB-404',
      `Cobranca ${txid} nao encontrada.`,
      HttpStatus.NOT_FOUND,
    );
  }

  static refundWindowExpired(days: number): MockBankError {
    return new MockBankError(
      'MB-DEVOL-001',
      `Janela de devolucao de ${days} dias ja encerrada.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  static refundExceedsOriginal(): MockBankError {
    return new MockBankError(
      'MB-DEVOL-002',
      'Soma das devolucoes excede o valor da transacao original.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  static limitExceeded(limitCents: bigint): MockBankError {
    return new MockBankError(
      'MB-LIMITE-001',
      'Limite de transacao excedido.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      {
        limit_cents: limitCents.toString(),
      },
    );
  }

  static unauthorized(): MockBankError {
    return new MockBankError('MB-AUTH-401', 'Token invalido ou expirado.', HttpStatus.UNAUTHORIZED);
  }

  static injected(): MockBankError {
    return new MockBankError(
      'MB-CHAOS-500',
      'Falha injetada pelo painel de controle do Mock Bank.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
