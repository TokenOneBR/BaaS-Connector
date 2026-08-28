import { BlindIndex, createKmsDriver, EnvelopeCrypto, type KmsDriver } from '@baasconn/crypto';
import { Global, Module } from '@nestjs/common';

import { ApiConfig } from '../config/config.service.js';

export const KMS_DRIVER = Symbol('BAAS_KMS_DRIVER');

/** Pepper de teste. Longo o bastante para o construtor aceitar, e so isso. */
const TEST_PEPPER = 'pepper-de-teste-com-32-caracteres-ou-mais';

@Global()
@Module({
  providers: [
    {
      provide: KMS_DRIVER,
      inject: [ApiConfig],
      useFactory: (config: ApiConfig): Promise<KmsDriver> =>
        createKmsDriver({
          driver: config.kmsDriver,
          keyId: config.kmsKeyId,
          masterSecret: config.kmsMasterSecret || (config.isTest ? 'segredo-mestre-de-teste' : ''),
        }),
    },
    {
      provide: EnvelopeCrypto,
      inject: [KMS_DRIVER],
      useFactory: (kms: KmsDriver) => new EnvelopeCrypto({ kms }),
    },
    {
      provide: BlindIndex,
      inject: [ApiConfig],
      useFactory: (config: ApiConfig) =>
        new BlindIndex(config.blindIndexPepper || (config.isTest ? TEST_PEPPER : '')),
    },
  ],
  exports: [KMS_DRIVER, EnvelopeCrypto, BlindIndex],
})
export class CryptoModule {}
