import { describe, expect, it } from "vitest"
import type { AgentCouplet, HyperPlanStrategy } from "./types"
import { crossReviewStrategy, ensembleStrategy, groupByDepth, isStandardStrategy, standardStrategy, topologicalSort, validateStrategy } from "./strategies"

const claude: AgentCouplet = { harnessId: "claude-code", modelId: "opus" }
const codex: AgentCouplet = { harnessId: "codex", modelId: "gpt-5.3-codex" }

describe("standardStrategy", () => {
    it("creates a single plan step", () => {
        const s = standardStrategy(claude)
        expect(s.steps).toHaveLength(1)
        expect(s.steps[0].primitive).toBe("plan")
        expect(s.steps[0].inputs).toEqual([])
        expect(s.terminalStepId).toBe("plan_0")
    })

    it("is recognized as standard", () => {
        expect(isStandardStrategy(standardStrategy(claude))).toBe(true)
    })
})

describe("ensembleStrategy", () => {
    it("creates N plan steps + 1 reconcile step", () => {
        const s = ensembleStrategy([claude, codex], claude)
        expect(s.steps).toHaveLength(3)
        expect(s.steps.filter((st) => st.primitive === "plan")).toHaveLength(2)
        expect(s.steps.filter((st) => st.primitive === "reconcile")).toHaveLength(1)
    })

    it("reconcile step depends on all plan steps", () => {
        const s = ensembleStrategy([claude, codex], claude)
        const reconcile = s.steps.find((st) => st.primitive === "reconcile")!
        expect(reconcile.inputs).toEqual(["plan_0", "plan_1"])
    })

    it("terminal step is the reconcile step", () => {
        const s = ensembleStrategy([claude, codex], claude)
        expect(s.terminalStepId).toBe("reconcile_0")
    })

    it("is not recognized as standard", () => {
        expect(isStandardStrategy(ensembleStrategy([claude, codex], claude))).toBe(false)
    })
})

describe("crossReviewStrategy", () => {
    it("creates 2 plan + 2 review + 1 reconcile steps", () => {
        const s = crossReviewStrategy(claude, codex, claude)
        expect(s.steps).toHaveLength(5)
        expect(s.steps.filter((st) => st.primitive === "plan")).toHaveLength(2)
        expect(s.steps.filter((st) => st.primitive === "review")).toHaveLength(2)
        expect(s.steps.filter((st) => st.primitive === "reconcile")).toHaveLength(1)
    })

    it("reviews reference the opposite plan", () => {
        const s = crossReviewStrategy(claude, codex, claude)
        const reviewA = s.steps.find((st) => st.id === "review_a_of_b")!
        const reviewB = s.steps.find((st) => st.id === "review_b_of_a")!
        expect(reviewA.inputs).toEqual(["plan_b"])
        expect(reviewB.inputs).toEqual(["plan_a"])
    })

    it("reconcile depends on all plans and reviews", () => {
        const s = crossReviewStrategy(claude, codex, claude)
        const reconcile = s.steps.find((st) => st.primitive === "reconcile")!
        expect(reconcile.inputs).toContain("plan_a")
        expect(reconcile.inputs).toContain("plan_b")
        expect(reconcile.inputs).toContain("review_a_of_b")
        expect(reconcile.inputs).toContain("review_b_of_a")
    })
})

describe("validateStrategy", () => {
    it("accepts valid standard strategy", () => {
        expect(validateStrategy(standardStrategy(claude))).toEqual([])
    })

    it("accepts valid ensemble strategy", () => {
        expect(validateStrategy(ensembleStrategy([claude, codex], claude))).toEqual([])
    })

    it("accepts valid cross-review strategy", () => {
        expect(validateStrategy(crossReviewStrategy(claude, codex, claude))).toEqual([])
    })

    it("rejects plan step with inputs", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [{ id: "plan_0", primitive: "plan", agent: claude, inputs: ["other"] }],
            terminalStepId: "plan_0",
        }
        const errors = validateStrategy(s)
        expect(errors).toContain('Plan step "plan_0" must have no inputs')
    })

    it("rejects review step with wrong input count", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [
                { id: "plan_0", primitive: "plan", agent: claude, inputs: [] },
                { id: "review_0", primitive: "review", agent: codex, inputs: [] },
            ],
            terminalStepId: "plan_0",
        }
        const errors = validateStrategy(s)
        expect(errors).toContain('Review step "review_0" must have exactly 1 input')
    })

    it("rejects reconcile step with no inputs", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [{ id: "reconcile_0", primitive: "reconcile", agent: claude, inputs: [] }],
            terminalStepId: "reconcile_0",
        }
        const errors = validateStrategy(s)
        expect(errors).toContain('Reconcile step "reconcile_0" must have at least 1 input')
    })

    it("rejects review as terminal step", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [
                { id: "plan_0", primitive: "plan", agent: claude, inputs: [] },
                { id: "review_0", primitive: "review", agent: codex, inputs: ["plan_0"] },
            ],
            terminalStepId: "review_0",
        }
        const errors = validateStrategy(s)
        expect(errors).toContain("Terminal step must produce a plan (plan or reconcile), not a review")
    })

    it("rejects unknown input references", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [
                { id: "plan_0", primitive: "plan", agent: claude, inputs: [] },
                { id: "reconcile_0", primitive: "reconcile", agent: claude, inputs: ["nonexistent"] },
            ],
            terminalStepId: "reconcile_0",
        }
        const errors = validateStrategy(s)
        expect(errors).toContain('Step "reconcile_0" references unknown input "nonexistent"')
    })

    it("rejects missing terminal step", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [{ id: "plan_0", primitive: "plan", agent: claude, inputs: [] }],
            terminalStepId: "missing",
        }
        const errors = validateStrategy(s)
        expect(errors).toContain('Terminal step "missing" not found')
    })

    it("rejects cycles", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [
                { id: "a", primitive: "reconcile", agent: claude, inputs: ["b"] },
                { id: "b", primitive: "reconcile", agent: claude, inputs: ["a"] },
            ],
            terminalStepId: "a",
        }
        const errors = validateStrategy(s)
        expect(errors).toContain("Strategy contains a cycle")
    })

    it("rejects multiple terminal nodes", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [
                { id: "plan_0", primitive: "plan", agent: claude, inputs: [] },
                { id: "plan_1", primitive: "plan", agent: codex, inputs: [] },
            ],
            terminalStepId: "plan_0",
        }
        const errors = validateStrategy(s)
        expect(errors.some((e) => e.includes("Expected 1 terminal step"))).toBe(true)
    })

    it("rejects duplicate step IDs", () => {
        const s: HyperPlanStrategy = {
            id: "bad",
            name: "Bad",
            description: "",
            steps: [
                { id: "plan_0", primitive: "plan", agent: claude, inputs: [] },
                { id: "plan_0", primitive: "plan", agent: codex, inputs: [] },
            ],
            terminalStepId: "plan_0",
        }
        const errors = validateStrategy(s)
        expect(errors).toContain("Duplicate step IDs")
    })
})

describe("topologicalSort", () => {
    it("returns plan steps before reconcile", () => {
        const s = ensembleStrategy([claude, codex], claude)
        const sorted = topologicalSort(s)
        const planIndices = sorted.filter((st) => st.primitive === "plan").map((st) => sorted.indexOf(st))
        const reconcileIndex = sorted.findIndex((st) => st.primitive === "reconcile")
        for (const pi of planIndices) {
            expect(pi).toBeLessThan(reconcileIndex)
        }
    })

    it("returns all steps", () => {
        const s = crossReviewStrategy(claude, codex, claude)
        expect(topologicalSort(s)).toHaveLength(5)
    })
})

describe("groupByDepth", () => {
    it("groups ensemble into 2 layers", () => {
        const s = ensembleStrategy([claude, codex], claude)
        const layers = groupByDepth(s)
        expect(layers).toHaveLength(2)
        expect(layers[0]).toHaveLength(2) // 2 plan steps
        expect(layers[1]).toHaveLength(1) // 1 reconcile step
    })

    it("groups cross-review into 3 layers", () => {
        const s = crossReviewStrategy(claude, codex, claude)
        const layers = groupByDepth(s)
        expect(layers).toHaveLength(3)
        expect(layers[0]).toHaveLength(2) // 2 plan steps
        expect(layers[1]).toHaveLength(2) // 2 review steps
        expect(layers[2]).toHaveLength(1) // 1 reconcile step
    })

    it("groups standard into 1 layer", () => {
        const s = standardStrategy(claude)
        const layers = groupByDepth(s)
        expect(layers).toHaveLength(1)
        expect(layers[0]).toHaveLength(1)
    })
})
