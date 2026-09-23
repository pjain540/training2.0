import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { OperationsAgentState, AgentStatus } from './state.mjs';
import { createAgentNodes } from './nodes.mjs';

export function routeAfterHumanGate(state) {
  const decision = state.humanDecision?.action;
  if (decision === 'REJECTED') {
    return 'abort';
  }
  return 'executor';
}

export function createOperationsGraph({
  mcpClient,
  retriever,
  evaluator,
  checkpointer = new MemorySaver()
} = {}) {
  const nodes = createAgentNodes({ mcpClient, retriever, evaluator });

  const workflow = new StateGraph(OperationsAgentState)
    .addNode('retriever', nodes.ragRetrieverNode)
    .addNode('triager', nodes.triageAgentNode)
    .addNode('evaluator', nodes.evaluatorAgentNode)
    .addNode('humanGate', nodes.humanGateNode)
    .addNode('executor', nodes.executorAgentNode)
    .addNode('abort', nodes.abortNode)
    .addNode('finalizer', nodes.finalizerNode)
    // Edges
    .addEdge(START, 'retriever')
    .addEdge('retriever', 'triager')
    .addEdge('triager', 'evaluator')
    .addEdge('evaluator', 'humanGate')
    .addConditionalEdges('humanGate', routeAfterHumanGate, {
      abort: 'abort',
      executor: 'executor'
    })
    .addEdge('abort', END)
    .addEdge('executor', 'finalizer')
    .addEdge('finalizer', END);

  const app = workflow.compile({ checkpointer });

  return {
    app,
    checkpointer
  };
}
