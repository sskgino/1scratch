import { z } from 'zod'

export const mutationSchema = z.object({
  id: z.string().min(1).max(64),
  entityType: z.enum(['card', 'canvas', 'section']),
  entityId: z.string().uuid(),
  op: z.enum(['upsert', 'delete']),
  patch: z.record(z.unknown()),
  clientVersion: z.string().regex(/^\d+$/),
})

export const pushRequestSchema = z.object({
  deviceId: z.string().min(1).max(64),
  baseVersion: z.string().regex(/^\d+$/),
  mutations: z.array(mutationSchema).max(500),
})

export const pullQuerySchema = z.object({
  since: z.string().regex(/^\d+$/),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 500) : 500)),
})

export type ValidatedMutation = z.infer<typeof mutationSchema>
export type ValidatedPush = z.infer<typeof pushRequestSchema>
