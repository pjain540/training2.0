/**
 * Day 7 — MCP Gemini Agent
 * Connects Gemini directly to an MCP Server, discovering tools dynamically
 * and executing an autonomous multi-turn tool calling loop.
 */

import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MCPClientBridge } from './mcp-client.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../../Day6/.env') });
}

export class MCPGeminiAgent {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    mcpBridge = null,
    temperature = 0.2
  } = {}) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Please provide it or configure .env');
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    this.mcpBridge = mcpBridge || new MCPClientBridge();
    this.temperature = temperature;
  }

  /**
   * Executes an autonomous tool loop over MCP tools to accomplish an objective.
   */
  async execute(prompt, { maxTurns = 5, onStep = null } = {}) {
    await this.mcpBridge.connect();

    // 1. Discover tools from MCP server and convert to Gemini declarations
    const geminiTools = await this.mcpBridge.toGeminiFunctionDeclarations();

    const systemInstruction = `
You are an intelligent Database & Inventory Operations Assistant connected to an MCP SQLite Server.
You have access to MCP tools: db_get_schema, db_query, and db_execute.
Rules:
1. When asked to solve an inventory or operational problem, first inspect the schema or query necessary tables.
2. Formulate valid SQL queries based on actual table columns.
3. If write operations (inserting orders, restocking) are requested, use db_execute.
4. When finished, provide a clear, professional summary of actions taken and final state.
`.trim();

    const chat = this.ai.chats.create({
      model: this.model,
      config: {
        temperature: this.temperature,
        systemInstruction,
        tools: geminiTools
      }
    });

    const executionLog = [];
    let currentMessage = prompt;
    let finalAnswer = '';

    for (let turn = 1; turn <= maxTurns; turn++) {
      if (onStep) {
        onStep({ type: 'model_call', turn, input: currentMessage });
      }

      const response = await chat.sendMessage({ message: currentMessage });
      const calls = response.functionCalls;

      if (!calls || calls.length === 0) {
        finalAnswer = response.text || '';
        if (onStep) {
          onStep({ type: 'final_answer', text: finalAnswer, turn });
        }
        break;
      }

      // Execute each function call via the MCP Server
      const functionResponses = [];
      for (const call of calls) {
        const { name, args } = call;
        if (onStep) {
          onStep({ type: 'tool_call', name, args, turn });
        }

        const toolResult = await this.mcpBridge.callTool(name, args);
        executionLog.push({
          turn,
          tool: name,
          args,
          result: toolResult.content,
          isError: toolResult.isError
        });

        if (onStep) {
          onStep({ type: 'tool_result', name, result: toolResult.content, isError: toolResult.isError, turn });
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: {
              output: toolResult.content,
              isError: toolResult.isError
            }
          }
        });
      }

      // Feed tool responses back to the model for next turn
      currentMessage = functionResponses;
    }

    return {
      finalAnswer,
      steps: executionLog
    };
  }

  async close() {
    await this.mcpBridge.close();
  }
}
