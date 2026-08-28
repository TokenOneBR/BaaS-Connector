import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { BaasError, BaasErrorCode, RequirementCode } from '@baasconn/taxonomy';
import { Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';

import { actorOf } from '../accounts/accounts.controller.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { Scopes, type AuthedRequest } from '../auth/api-key.guard.js';
import { RequiresCapability } from '../auth/capability.guard.js';

import { OnboardingService } from './onboarding.service.js';

/** Teto do documento. Acima disso e engano ou ataque. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

@Controller('v1')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly accounts: AccountsService,
  ) {}

  @Get('accounts/:id/onboarding')
  @Scopes('onboarding:read')
  @RequiresCapability('onboarding.status.get')
  async status(@Param('id') accountId: string, @Req() request: AuthedRequest) {
    const actor = actorOf(request);
    return this.onboarding.statusOf(actor, accountId);
  }

  /**
   * Envio de documento, em STREAM.
   *
   * O corpo vai como bytes crus (`application/octet-stream`), nao base64 em
   * JSON: um documento de identidade fotografado passa facil de 10 MB, base64
   * o infla em um terco, e bufferizar tudo antes de decidir se aceita e como
   * um upload vira uma queda de pod.
   *
   * O sha256 e calculado enquanto passa, e repassado ao provedor: e o que
   * torna um upload truncado detectavel dos dois lados.
   */
  @Post('onboarding/:caseId/documents')
  @Scopes('onboarding:documents')
  @RequiresCapability('onboarding.document.upload')
  async uploadDocument(
    @Param('caseId') caseId: string,
    @Query('code') code: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Headers('x-filename') filename: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    const actor = actorOf(request);

    if (!code || !(code in RequirementCode)) {
      throw new BaasError(BaasErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'code',
            message: `Informe ?code= com uma pendencia valida. Recebido: ${code ?? '(vazio)'}.`,
          },
        ],
      });
    }

    const bytes = await readBody(request);

    return this.onboarding.uploadDocument(actor, caseId, {
      kind: RequirementCode[code as keyof typeof RequirementCode],
      filename: filename ?? 'documento',
      contentType: contentType ?? 'application/octet-stream',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      content: () => {
        const stream = new PassThrough();
        stream.end(bytes);
        return stream;
      },
    });
  }

  @Post('onboarding/:caseId/requirements/:code/fulfill')
  @Scopes('onboarding:write')
  @RequiresCapability('onboarding.requirements.fulfill')
  async fulfill(
    @Param('caseId') caseId: string,
    @Param('code') code: string,
    @Req() request: AuthedRequest,
  ) {
    return this.onboarding.fulfill(actorOf(request), caseId, code);
  }
}

function readBody(request: AuthedRequest): Promise<Buffer> {
  // O corpo cru pode ja ter sido capturado pelo middleware de webhook; nas
  // rotas /v1 ele nao foi, entao lemos aqui com teto.
  if (request.rawBody) return Promise.resolve(request.rawBody);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DOCUMENT_BYTES) {
        request.destroy();
        reject(
          new BaasError(BaasErrorCode.VALIDATION_ERROR, {
            message: 'Documento acima de 20 MiB.',
          }),
        );
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
