import type { ProviderAdapterFactory } from '@baasconn/provider-spi';
import { Module } from '@nestjs/common';

import { CredentialResolver } from './credential.resolver.js';
import { PROVIDER_FACTORIES, ProviderRegistry } from './provider.registry.js';
import { ProviderResolver } from './provider.resolver.js';

/**
 * Adapters compilados neste deploy.
 *
 * Lista estatica de proposito: carregamento dinamico derrotaria a validacao de
 * manifesto no boot, que e justamente o que impede um adapter prometer uma
 * capacidade que nao implementa. Quem precisa de um adapter privado publica
 * `@sua-org/baas-provider-x` e acrescenta uma linha aqui.
 *
 * Vazia enquanto os adapters nao existem: o registry aceita e `/v1/providers`
 * responde lista vazia, em vez de o boot falhar num deploy recem-criado que
 * ainda nao tem credencial de BaaS nenhuma.
 */
export const PROVIDER_ADAPTERS: ProviderAdapterFactory[] = [];

@Module({
  providers: [
    CredentialResolver,
    ProviderRegistry,
    ProviderResolver,
    { provide: PROVIDER_FACTORIES, useValue: PROVIDER_ADAPTERS },
  ],
  exports: [CredentialResolver, ProviderRegistry, ProviderResolver],
})
export class ProvidersModule {}
