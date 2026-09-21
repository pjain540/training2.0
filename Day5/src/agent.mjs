/**
 * Day 5 — LangGraph ReAct Agent
 *
 * Wraps createReactAgent (LangGraph prebuilt) with:
 *   • ChatGoogleGenerativeAI as the LLM backbone
 *   • knowledge_base_search + calculator tools
 *   • In-memory message history for multi-turn conversations
 *   • Verbose step-tracing via callbacks
 *
 * Compare to Day 2: ~300 lines of hand-rolled agent loop, tool registry,
 * prompt assembly, and thought/act/observe parsing.
 * Here: ~80 lines. LangGraph owns the loop; framework cost = opacity.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import dotenv from 'dotenv';

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

import { RAGChain } from './rag-chain.mjs';
import { createKnowledgeBaseTool, calculatorTool } from './tools/rag-tool.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

// ─── Agent Factory ───────────────────────────────────────────────────────────

/**
 * Builds and returns a ready-to-use LangGraph ReAct agent with:
 *   - An ingested RAG knowledge base
 *   - knowledge_base_search + calculator tools
 *   - Conversation history support
 *
 * @param {Object} [options]
 * @param {string} [options.docsDir]  - Directory to ingest for RAG
 * @param {string} [options.apiKey]
 * @param {string} [options.model]
 * @param {(msg: string) => void} [options.onStatus]
 * @returns {Promise<{ invoke: Function, history: import('@langchain/core/messages').BaseMessage[] }>}
 */
export async function createDay5Agent({
  docsDir = join(__dirname, '../docs'),
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  onStatus = () => {}
} = {}) {
  if (!apiKey) throw new Error('Agent: GEMINI_API_KEY is required.');

  // 1. Set up RAG chain and ingest documents
  onStatus('🔍 Initialising RAG chain…');
  const ragChain = new RAGChain({ apiKey, model });
  await ragChain.ingest(docsDir, onStatus);

  // 2. Build tools
  const tools = [
    createKnowledgeBaseTool(ragChain),
    calculatorTool
  ];

  // 3. LLM for the agent (must support tool-calling)
  const llm = new ChatGoogleGenerativeAI({ apiKey, model, temperature: 0 });

  // 4. createReactAgent from LangGraph — replaces entire Day-2 agent loop
  const agent = createReactAgent({ llm, tools });

  // 5. In-memory conversation history
  const history = [];

  /**
   * Run one turn of the agent.
   * @param {string} userMessage
   * @param {{ verbose?: boolean }} [opts]
   * @returns {Promise<{ answer: string, toolCalls: string[] }>}
   */
  async function invoke(userMessage, { verbose = false } = {}) {
    history.push(new HumanMessage(userMessage));

    const result = await agent.invoke(
      { messages: history },
      {
        callbacks: verbose ? [new TracingCallbackHandler()] : []
      }
    );

    // Extract final AI response
    const messages = result.messages ?? [];
    const lastAI = [...messages].reverse().find(m => m._getType?.() === 'ai');
    const answer = lastAI?.content ?? '(no response)';

    // Collect tool call names from intermediate messages
    const toolCalls = messages
      .filter(m => m._getType?.() === 'tool')
      .map(m => m.name ?? 'unknown_tool');

    history.push(new AIMessage(answer));

    return { answer, toolCalls, allMessages: messages };
  }

  return { invoke, history, ragChain };
}

// ─── Verbose Tracing Callback ────────────────────────────────────────────────

/**
 * A simple LangChain callback that prints each agent step to console.
 * Demonstrates how LangChain's callback system exposes normally-hidden internals.
 */
class TracingCallbackHandler {
  handleLLMStart(_llm, _prompts) {
    console.log('\n  🤔 [LLM] Thinking…');
  }
  handleToolStart(_tool, input) {
    console.log(`\n  🔧 [Tool] Calling → ${JSON.stringify(input)}`);
  }
  handleToolEnd(output) {
    const preview = String(output).slice(0, 120).replace(/\n/g, ' ');
    console.log(`  ✅ [Tool] Result  → ${preview}${output.length > 120 ? '…' : ''}`);
  }
  handleAgentAction(action) {
    console.log(`\n  ⚡ [Agent] Action → ${action.tool}: ${JSON.stringify(action.toolInput)}`);
  }
  handleAgentEnd(finish) {
    const preview = String(finish.returnValues?.output ?? '').slice(0, 100);
    console.log(`\n  🏁 [Agent] Final → ${preview}`);
  }
  handleLLMError(err) {
    console.error(`  ❌ [LLM] Error: ${err.message}`);
  }
  handleToolError(err) {
    console.error(`  ❌ [Tool] Error: ${err.message}`);
  }
}
