import { z } from "zod"

export const CronAssistSchema = z.object({
    schedule: z.string().min(1),
    summary: z.string().min(1),
    assumptions: z.array(z.string()).default([]),
})

export const SuggestedProcessSchema = z.object({
    name: z.string().min(1),
    type: z.enum(["setup", "daemon", "task", "check"]),
    command: z.string().min(1),
    workDir: z.string().optional(),
    url: z.string().optional(),
    reason: z.string().min(1),
})

export const SuggestedCronSchema = z.object({
    name: z.string().min(1),
    schedule: z.string().min(1),
    type: z.enum(["plan", "do", "ask", "hyperplan"]),
    prompt: z.string().min(1),
    reason: z.string().min(1),
})

export const ProcsRecommendationsSchema = z.object({
    processes: z.array(SuggestedProcessSchema).default([]),
    crons: z.array(SuggestedCronSchema).default([]),
})

export type CronAssistResult = z.infer<typeof CronAssistSchema>
export type ProcsRecommendations = z.infer<typeof ProcsRecommendationsSchema>
