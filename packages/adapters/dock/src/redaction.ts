import { BASE_REDACTION, extendRedaction } from '@baasconn/adapter-kit';

/** Caminhos sensiveis especificos deste provedor. */
export const redaction = extendRedaction(BASE_REDACTION, {
  maskPaths: [],
});
