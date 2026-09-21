import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { PipelineStateAnnotation } from './state.mjs';
import { createResearcherNode } from './nodes/researcher.mjs';
import { createWriterNode } from './nodes/writer.mjs';
import { createCriticNode } from './nodes/critic.mjs';
import { createHumanApprovalNode } from './nodes/human.mjs';

/**
 * Conditional routing logic for Critic's evaluation:
 * - If status is REVISE and iteration < maxIterations -> cycle back to Writer
 * - Otherwise (APPROVED or max revisions reached) -> advance to Human Approval checkpoint
 */
export function routeAfterCritic(state) {
  const critiques = state.critiqueHistory || [];
  const lastCritique = critiques[critiques.length - 1];

  if (lastCritique && lastCritique.status === 'REVISE' && state.iteration < state.maxIterations) {
    return 'writer';
  }
  return 'humanApproval';
}

/**
 * Builds and compiles the Day 6 Multi-Agent Pipeline as a LangGraph StateGraph.
 *
 * Graph Topology:
 *   [START]
 *      ↓
 *  [researcher]
 *      ↓
 *    [writer] ←──┐ (revision cycle)
 *      ↓         │
 *   [critic] ────┘ (conditional edge: status == REVISE && iter < max)
 *      ↓
 * [humanApproval] (checkpointed HITL interrupt)
 *      ↓
 *    [END]
 */
export function createMultiAgentGraph({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  checkpointer = new MemorySaver(),
  outputDir = './output',
  nodes = {}
} = {}) {
  const researcherNode = nodes.researcher || createResearcherNode({ apiKey });
  const writerNode = nodes.writer || createWriterNode({ apiKey, model });
  const criticNode = nodes.critic || createCriticNode({ apiKey, model });
  const humanApprovalNode = nodes.humanApproval || createHumanApprovalNode({ outputDir });

  const workflow = new StateGraph(PipelineStateAnnotation)
    .addNode('researcher', researcherNode)
    .addNode('writer', writerNode)
    .addNode('critic', criticNode)
    .addNode('humanApproval', humanApprovalNode)
    // Edges
    .addEdge(START, 'researcher')
    .addEdge('researcher', 'writer')
    .addEdge('writer', 'critic')
    // Conditional revision edge
    .addConditionalEdges('critic', routeAfterCritic, {
      writer: 'writer',
      humanApproval: 'humanApproval'
    })
    .addEdge('humanApproval', END);

  return workflow.compile({ checkpointer });
}
