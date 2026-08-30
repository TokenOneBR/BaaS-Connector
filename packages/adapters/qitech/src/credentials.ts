import { z } from 'zod';

/**
 * Credenciais da QI Tech.
 *
 * A QI Tech nao usa segredo compartilhado: a autenticacao e por PAR DE CHAVES.
 * Assinamos a requisicao com a nossa privada e verificamos a resposta com a
 * publica deles. Sao dois materiais criptograficos distintos, e trocar um pelo
 * outro produz erro de assinatura que nao diz qual lado falhou.
 */
export const credentialsSchema = z.object({
  apiKey: z.string().min(1, 'apiKey e obrigatoria'),
  /** Nossa chave privada, PEM PKCS#8. Assina o que enviamos. */
  privateKey: z.string().min(1, 'privateKey e obrigatoria'),
  /**
   * Chave publica da QI Tech, PEM SPKI. Verifica o que recebemos.
   *
   * Opcional so porque o boot constroi o adapter sem credencial; na pratica,
   * sem ela nao ha como verificar resposta, e verificar a resposta e METADE do
   * contrato deste provedor.
   */
  providerPublicKey: z.string().min(1).optional(),
  /** Identificador da nossa chave, para o `kid` do JWS. */
  keyId: z.string().min(1).optional(),
});

export type QiTechCredentials = z.infer<typeof credentialsSchema>;
