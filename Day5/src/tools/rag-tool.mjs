/**
 * Day 5 — LangChain Tool Definitions
 *
 * Two DynamicStructuredTools (Zod-validated) that the LangGraph ReAct agent
 * can call:
 *   1. knowledge_base_search  — queries the RAG chain and returns cited context
 *   2. calculator             — evaluates a math expression using Function()
 *
 * Compare to Day 2: hand-rolled tools needed a custom registry, JSON schemas,
 * and manual dispatch. Here Zod + tool() declarative binding handles all that.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// ─── RAG Tool Factory ────────────────────────────────────────────────────────

/**
 * Creates a LangChain tool that wraps a RAGChain instance.
 * The agent can call this to search the knowledge base and get cited answers.
 *
 * @param {import('./rag-chain.mjs').RAGChain} ragChain - An already-ingested RAGChain
 * @returns {import('@langchain/core/tools').DynamicStructuredTool}
 */
export function createKnowledgeBaseTool(ragChain) {
  return tool(
    async ({ query }) => {
      try {
        const { answer, sources } = await ragChain.query(query);
        const sourceList = sources.length > 0
          ? `\n\nSources consulted: ${sources.join(', ')}`
          : '';
        return `${answer}${sourceList}`;
      } catch (err) {
        return `Error querying knowledge base: ${err.message}`;
      }
    },
    {
      name: 'knowledge_base_search',
      description:
        'Search the internal knowledge base (NebulaCloud documentation) for factual information about architecture, SLAs, security, and troubleshooting. Use this for any question about the system.',
      schema: z.object({
        query: z
          .string()
          .describe('The question or search query to look up in the knowledge base.')
      })
    }
  );
}

// ─── Calculator Tool ─────────────────────────────────────────────────────────

/**
 * Calculator tool for numeric evaluation.
 * Mirrors the Day-2 hand-rolled calculator but defined declaratively.
 *
 * @type {import('@langchain/core/tools').DynamicStructuredTool}
 */
export const calculatorTool = tool(
  async ({ expression }) => {
    try {
      // Sanitize: only allow digits and math operators
      const sanitized = expression.replace(/[^0-9+\-*/().% \t]/g, '');
      if (!sanitized.trim()) {
        return 'Error: No valid mathematical expression found.';
      }
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${sanitized})`)();
      if (typeof result !== 'number' || !isFinite(result)) {
        return 'Error: Expression did not evaluate to a finite number.';
      }
      return `Result: ${result}`;
    } catch (err) {
      return `Calculator error: ${err.message}`;
    }
  },
  {
    name: 'calculator',
    description:
      'Evaluate a mathematical expression. Use for arithmetic, percentages, and multi-step calculations. Input must be a valid JS math expression (e.g., "8760 * 0.001", "365 * 24 * (1 - 0.9999)").',
    schema: z.object({
      expression: z
        .string()
        .describe('A valid JavaScript math expression to evaluate (no variables, no function calls).')
    })
  }
);
