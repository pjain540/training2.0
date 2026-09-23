import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OperationsMCPClient {
  constructor({
    serverPath = join(__dirname, 'server.mjs'),
    transport = null,
    clientName = 'langgraph-operations-bridge'
  } = {}) {
    this.serverPath = serverPath;
    this.customTransport = transport;
    this.clientName = clientName;
    this.client = null;
    this.transport = null;
  }

  async connect() {
    if (this.client) return this;

    this.client = new Client(
      { name: this.clientName, version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
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
    const res = await this.client.listTools();
    return res.tools || [];
  }

  async listResources() {
    await this.connect();
    const res = await this.client.listResources();
    return res.resources || [];
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
