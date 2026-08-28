import {
  DeliveryStatus,
  Environment,
  EventType,
  ProviderSlug,
  SubscriptionStatus,
} from '@baasconn/taxonomy';
import { z } from 'zod';

import { zPaginationQuery } from '../common/pagination.js';
import { zEnum, zTimestamp } from '../common/primitives.js';

export const zEventEnvelope = z.object({
  id: z.string(),
  object: z.literal('event').default('event'),
  type: zEnum(EventType),
  spec_version: z.literal('1.0'),
  data_version: z.number().int().positive(),
  environment: zEnum(Environment),
  provider: zEnum(ProviderSlug).nullish(),
  connection_id: z.string().nullish(),
  resource: z.object({ type: z.string(), id: z.string() }),
  /** Monotonico por ambiente: permite ao consumidor detectar evento perdido. */
  sequence: z.string(),
  occurred_at: zTimestamp,
  published_at: zTimestamp,
  data: z.unknown(),
  previous: z.unknown().optional(),
  livemode: z.boolean(),
});

export type EventEnvelopeDto = z.infer<typeof zEventEnvelope>;

/** Glob de tipo de evento: 'pix.*', '*' ou um tipo exato. */
const zEventTypeFilter = z
  .string()
  .regex(/^(\*|[a-z_]+\.\*|[a-z_]+\.[a-z_]+)$/, 'Use um tipo exato, "recurso.*" ou "*"');

export const zCreateWebhookEndpoint = z.object({
  url: z
    .string()
    .url()
    .max(1024)
    .refine((u) => u.startsWith('https://'), {
      message: 'A URL de webhook precisa usar HTTPS',
    }),
  description: z.string().max(255).optional(),
  /** Vazio significa todos os tipos. */
  event_types: z.array(zEventTypeFilter).default([]),
});

export const zWebhookEndpoint = z.object({
  id: z.string(),
  object: z.literal('webhook_endpoint').default('webhook_endpoint'),
  url: z.string(),
  description: z.string().nullish(),
  event_types: z.array(z.string()),
  status: zEnum(SubscriptionStatus),
  consecutive_failures: z.number().int().nonnegative(),
  /** Exibido apenas na criacao e na rotacao. Depois, nunca mais. */
  secret: z.string().optional(),
  created_at: zTimestamp,
});

export const zWebhookDelivery = z.object({
  id: z.string(),
  event_id: z.string(),
  endpoint_id: z.string(),
  attempt: z.number().int().positive(),
  status: zEnum(DeliveryStatus),
  response_status: z.number().int().nullish(),
  /** Primeiros 2 KB, redigidos. */
  response_body_snippet: z.string().nullish(),
  duration_ms: z.number().int().nullish(),
  error: z.string().nullish(),
  scheduled_for: zTimestamp,
  attempted_at: zTimestamp.nullish(),
});

export const zListEventsQuery = zPaginationQuery.extend({
  type: z.string().optional(),
  resource_id: z.string().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
});
