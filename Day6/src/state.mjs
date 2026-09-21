import { Annotation } from '@langchain/langgraph';

/**
 * Status constants matching Day 4 lifecycle
 */
export const AgentStatus = {
  INITIALIZED: 'INITIALIZED',
  RESEARCHED: 'RESEARCHED',
  DRAFTED: 'DRAFTED',
  CRITIQUED: 'CRITIQUED',
  HITL_PENDING: 'HITL_PENDING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED'
};

/**
 * Helper logger for formatted log messages
 */
export function formatLog(agent, message) {
  const time = new Date().toISOString().split('T')[1].slice(0, 8);
  return `[${time}] [${agent}]: ${message}`;
}

/**
 * LangGraph State Annotation Schema for Day 6 Multi-Agent Pipeline.
 * Explicitly models blackboard state with reducers and defaults.
 */
export const PipelineStateAnnotation = Annotation.Root({
  // Target topic or query
  topic: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => ''
  }),

  // Current revision iteration count
  iteration: Annotation({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => 0
  }),

  // Maximum allowed revision iterations
  maxIterations: Annotation({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => 1
  }),

  // Facts retrieved during research phase
  facts: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => []
  }),

  // Citations list
  citations: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => []
  }),

  // Current draft text
  draft: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => ''
  }),

  // History of previous drafts
  draftHistory: Annotation({
    reducer: (curr, update) => (update ? curr.concat(update) : curr),
    default: () => []
  }),

  // History of critique evaluations
  critiqueHistory: Annotation({
    reducer: (curr, update) => (update ? curr.concat(update) : curr),
    default: () => []
  }),

  // Current lifecycle status
  status: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => AgentStatus.INITIALIZED
  }),

  // Human operator decision: { action, notes, savedPath, decidedAt }
  humanDecision: Annotation({
    reducer: (curr, update) => (update ? { ...curr, ...update } : curr),
    default: () => null
  }),

  // Execution logs
  logs: Annotation({
    reducer: (curr, update) => (update ? curr.concat(update) : curr),
    default: () => []
  })
});
