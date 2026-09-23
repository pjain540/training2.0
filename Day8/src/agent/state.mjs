import { Annotation } from '@langchain/langgraph';

export const AgentStatus = {
  INIT: 'INIT',
  RETRIEVED: 'RETRIEVED',
  DIAGNOSED: 'DIAGNOSED',
  EVALUATED: 'EVALUATED',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  COMMITTED: 'COMMITTED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED'
};

export const OperationsAgentState = Annotation.Root({
  ticket: Annotation({
    reducer: (curr, update) => (update ? { ...curr, ...update } : curr),
    default: () => ({ ticket_number: 'INC-8091' })
  }),
  retrievedDocs: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => []
  }),
  citations: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => []
  }),
  diagnosisDraft: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => ''
  }),
  proposedAction: Annotation({
    reducer: (curr, update) => (update ? { ...curr, ...update } : curr),
    default: () => null
  }),
  evaluation: Annotation({
    reducer: (curr, update) => (update ? { ...curr, ...update } : curr),
    default: () => null
  }),
  humanDecision: Annotation({
    reducer: (curr, update) => (update ? { ...curr, ...update } : curr),
    default: () => null
  }),
  mcpExecutionResult: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => null
  }),
  finalAnswer: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => ''
  }),
  status: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => AgentStatus.INIT
  }),
  logs: Annotation({
    reducer: (curr, update) => (update ? [...curr, ...(Array.isArray(update) ? update : [update])] : curr),
    default: () => []
  })
});

export function formatLog(role, message) {
  const time = new Date().toISOString().substring(11, 19);
  return `[${time}] [${role}] ${message}`;
}
