import { BaasErrorCategory, BaasErrorCode } from '@baasconn/taxonomy';
import { z } from 'zod';

import { zEnum } from './primitives.js';

export const zErrorDetail = z.object({
  field: z.string().optional(),
  code: z.string().optional(),
  message: z.string(),
});

export const zErrorResponse = z.object({
  error: z.object({
    code: zEnum(BaasErrorCode),
    category: zEnum(BaasErrorCategory),
    message: z.string(),
    message_ptbr: z.string(),
    retryable: z.boolean(),
    docs_url: z.string(),
    details: z.array(zErrorDetail).optional(),
    request_id: z.string().optional(),
    provider: z
      .object({
        slug: z.string(),
        code: z.string().optional(),
        message: z.string().optional(),
        request_id: z.string().optional(),
      })
      .optional(),
  }),
});

export type ErrorResponse = z.infer<typeof zErrorResponse>;
