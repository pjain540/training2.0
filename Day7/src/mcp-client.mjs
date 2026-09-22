/**
 * Day 7 — MCP Client Bridge
 * Connects to MCP Servers over stdio or in-memory transport,
 * discovers tools & resources, and maps MCP schemas into LLM function declarations.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MCPClientBridge {
  constructor({
    serverPath = join(__dirname, 'server.mjs'),
    clientName = 'mcp-agent-bridge',
    clientVersion = '1.0.0',
    transport = null
  } = {}) {
    this.serverPath = serverPath;
    this.clientName = clientName;
    this.clientVersion = clientVersion;
    this.customTransport = transport;
    this.client = null;
    this.transport = null;
    this._cachedTools = null;
  }

  async connect() {
    if (this.client) return this;

    this.client = new Client(
      {
        name: this.clientName,
        version: this.clientVersion
      },
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {}
        }
      }
    );

    if (this.customTransport) {
      this.transport = this.customTransport;
    } else {
      this.transport = new StdioClientTransport({
        command: process.execPath,
        args: [this.serverPath]
      });
    }

    await this.client.connect(this.transport);
    return this;
  }

  async listTools() {
    await this.connect();
    const result = await this.client.listTools();
    this._cachedTools = result.tools || [];
    return this._cachedTools;
  }

  async listResources() {
    await this.connect();
    const result = await this.client.listResources();
    return result.resources || [];
  }

  async readResource(uri) {
    await this.connect();
    return this.client.readResource({ uri });
  }

  async callTool(name, args = {}) {
    await this.connect();
    const response = await this.client.callTool({
      name,
      arguments: args
    });

    // Extract text content from tool response
    let textOutput = '';
    if (response.content && Array.isArray(response.content)) {
      textOutput = response.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }

    return {
      isError: !!response.isError,
      content: textOutput,
      raw: response
    };
  }

  /**
   * Translates MCP tool definitions into Gemini / Day 1 function declaration format.
   * Strips non-standard JSON schema keywords ($schema, etc.) for clean LLM ingestion.
   */
  async toGeminiFunctionDeclarations() {
    const tools = await this.listTools();

    const functionDeclarations = tools.map(tool => {
      const inputSchema = tool.inputSchema || { type: 'object', properties: {} };

      // Clean schema for Gemini parameters
      const cleanProperties = {};
      if (inputSchema.properties) {
        for (const [propName, propDef] of Object.entries(inputSchema.properties)) {
          cleanProperties[propName] = {
            type: propDef.type || 'string',
            description: propDef.description || ''
          };
          if (propDef.items) {
            cleanProperties[propName].items = {
              type: propDef.items.type || 'string'
            };
          }
        }
      }

      return {
        name: tool.name,
        description: tool.description || '',
        parameters: {
          type: 'object',
          properties: cleanProperties,
          ...(inputSchema.required && inputSchema.required.length > 0
            ? { required: inputSchema.required }
            : {})
        }
      };
    });

    return [{ functionDeclarations }];
  }

  async close() {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // transport may already be closed
      }
      this.client = null;
      this.transport = null;
    }
  }
}
