import { z } from "zod"

import type { Keys, Equals, AssertEqual } from "./type-fu.js"

/**
 * ExperimentId
 */

export const experimentIds = [
	"autoCondenseContext",
	"powerSteering",
	"enableMultiToolCalls",
	"blockWritingReadFiles",
	"blockAttemptCompletionWithTools",
] as const

export const experimentIdsSchema = z.enum(experimentIds)

export type ExperimentId = z.infer<typeof experimentIdsSchema>

/**
 * Experiments
 */

export const experimentsSchema = z.object({
	powerSteering: z.boolean(),
	enableMultiToolCalls: z.boolean(),
	autoCondenseContext: z.boolean(),
	blockWritingReadFiles: z.boolean(),
	blockAttemptCompletionWithTools: z.boolean(),
})

export type Experiments = z.infer<typeof experimentsSchema>

type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<Experiments>>>
