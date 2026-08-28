import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Driver de KMS.
 *
 * A interface e minima de proposito: envolver e desenvolver uma chave de dados.
 * E o que permite ao mesmo chart rodar em EKS, GKE e AKS mudando so uma
 * anotacao de ServiceAccount, e ao `docker compose up` funcionar sem
 * provisionar secret manager nenhum.
 */
export interface KmsDriver {
  readonly name: string;
  /** Envolve uma DEK em claro. Devolve o blob cifrado e o id da chave usada. */
  wrap(dataKey: Buffer): Promise<{ wrapped: Buffer; keyId: string }>;
  unwrap(wrapped: Buffer, keyId: string): Promise<Buffer>;
}

/**
 * Driver local: chave mestra derivada de uma senha em variavel de ambiente.
 *
 * Para desenvolvimento e teste. Em producao use um KMS de nuvem — o `keyId`
 * marca `local` justamente para uma auditoria conseguir identificar dado
 * cifrado com este driver.
 */
export class LocalKmsDriver implements KmsDriver {
  readonly name = 'local';
  private readonly masterKey: Buffer;

  constructor(masterSecret: string, salt = 'baas-connector-local-kms') {
    if (masterSecret.length < 16) {
      throw new Error('A chave mestra local precisa de ao menos 16 caracteres');
    }
    this.masterKey = scryptSync(masterSecret, salt, 32);
  }

  async wrap(dataKey: Buffer): Promise<{ wrapped: Buffer; keyId: string }> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    // iv | tag | ciphertext, num blob so, para simplificar o armazenamento.
    return {
      wrapped: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
      keyId: 'local:v1',
    };
  }

  async unwrap(wrapped: Buffer, keyId: string): Promise<Buffer> {
    if (!keyId.startsWith('local:')) {
      throw new Error(`Chave ${keyId} nao foi envolvida pelo driver local`);
    }
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const ciphertext = wrapped.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export type KmsDriverKind = 'local' | 'aws-kms' | 'gcp-kms' | 'azure-kv';

export interface KmsConfig {
  driver: KmsDriverKind;
  /** ARN, resource name ou identificador da chave na nuvem. */
  keyId?: string;
  /** Somente para o driver local. */
  masterSecret?: string;
}

/**
 * Resolve o driver a partir da configuracao.
 *
 * Os drivers de nuvem sao carregados por import dinamico, para o pacote nao
 * arrastar os SDKs das tres nuvens em toda instalacao.
 */
export async function createKmsDriver(config: KmsConfig): Promise<KmsDriver> {
  switch (config.driver) {
    case 'local':
      if (!config.masterSecret) {
        throw new Error('KMS_MASTER_SECRET e obrigatorio com o driver local');
      }
      return new LocalKmsDriver(config.masterSecret);

    case 'aws-kms':
    case 'gcp-kms':
    case 'azure-kv':
      throw new Error(
        `Driver ${config.driver} ainda nao implementado. ` +
          `Implemente KmsDriver e registre aqui; a interface e wrap/unwrap de uma DEK.`,
      );
  }
}
