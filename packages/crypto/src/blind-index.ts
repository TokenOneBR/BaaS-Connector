import { createHmac } from 'node:crypto';

import { onlyDigits } from '@baasconn/taxonomy';

/**
 * Blind index.
 *
 * E o que torna possivel "achar a conta do CPF X" sem descriptografar a tabela
 * inteira. O pepper vive no KMS ou no secret manager, nunca no banco: um
 * vazamento so do banco nao entrega nem o documento nem um hash atacavel por
 * rainbow table, porque sem o pepper o espaco de busca de 11 digitos deixa de
 * ser enumeravel.
 */
export class BlindIndex {
  constructor(private readonly pepper: string) {
    if (pepper.length < 32) {
      throw new Error(
        'O pepper do blind index precisa de ao menos 32 caracteres: ' +
          'CPF tem 11 digitos e um pepper curto nao impede enumeracao.',
      );
    }
  }

  /** Indexa um documento. Normaliza antes, para mascara nao gerar indices diferentes. */
  taxId(value: string): string {
    return this.compute('taxid', onlyDigits(value));
  }

  email(value: string): string {
    return this.compute('email', value.trim().toLowerCase());
  }

  pixKey(value: string): string {
    return this.compute('pixkey', value.trim().toLowerCase());
  }

  /** Indice generico, com dominio separado para nao haver colisao entre tipos. */
  compute(domain: string, value: string): string {
    return createHmac('sha256', this.pepper).update(`${domain}:${value}`).digest('hex');
  }
}
