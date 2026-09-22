#!/usr/bin/env node
/**
 * Day 7 — Custom MCP Server
 * Exposes a real SQLite database system over the Model Context Protocol (MCP).
 *
 * Capabilities:
 * - Tools: db_get_schema, db_query, db_execute (with Zod validation & safety checks)
 * - Resources: inventory://schema, inventory://stats
 * - Prompts: inventory_audit
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { InventoryDatabase } from './db.mjs';

export function createInventoryServer(dbInstanceOrPath) {
  let db;
  let initPromise = null;

  async function getDb() {
    if (db) return db;
    if (dbInstanceOrPath instanceof InventoryDatabase) {
      db = dbInstanceOrPath;
      await db.init();
      return db;
    }
    if (!initPromise) {
      const dbInstance = new InventoryDatabase(typeof dbInstanceOrPath === 'string' ? dbInstanceOrPath : undefined);
      initPromise = dbInstance.init().then(d => {
        db = d;
        return d;
      });
    }
    return initPromise;
  }

  const server = new McpServer({
    name: 'sqlite-inventory-mcp',
    version: '1.0.0'
  });

  // ── Tool 1: Inspect Database Schema ───────────────────────────────────────
  server.tool(
    'db_get_schema',
    'Get database table names and DDL schemas for tables in the inventory database',
    {
      tableName: z.string().optional().describe('Optional specific table name to inspect (e.g. products, orders, suppliers)')
    },
    async ({ tableName }) => {
      try {
        const database = await getDb();
        let schema = database.getSchema();
        if (tableName) {
          schema = schema.filter(t => t.name.toLowerCase() === tableName.toLowerCase());
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ tables: schema }, null, 2)
            }
          ]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error retrieving schema: ${err.message}` }]
        };
      }
    }
  );

  // ── Tool 2: Read-Only SQL Query ───────────────────────────────────────────
  server.tool(
    'db_query',
    'Execute a read-only SELECT SQL query on the inventory database. Destructive queries are rejected.',
    {
      sql: z.string().min(1).describe('The SELECT SQL query string to run'),
      params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('Positional parameters for ? placeholders')
    },
    async ({ sql, params = [] }) => {
      try {
        const database = await getDb();
        const rows = database.query(sql, params);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ count: rows.length, rows }, null, 2)
            }
          ]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Query execution failed: ${err.message}` }]
        };
      }
    }
  );

  // ── Tool 3: Execute Write SQL Statement ────────────────────────────────────
  server.tool(
    'db_execute',
    'Execute an INSERT, UPDATE, or DELETE SQL statement against the inventory database',
    {
      sql: z.string().min(1).describe('The INSERT, UPDATE, or DELETE SQL statement'),
      params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('Positional parameters for ? placeholders')
    },
    async ({ sql, params = [] }) => {
      try {
        const database = await getDb();
        const result = database.execute(sql, params);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Statement execution failed: ${err.message}` }]
        };
      }
    }
  );

  // ── Resource 1: Database Schema ───────────────────────────────────────────
  server.resource(
    'db-schema',
    'inventory://schema',
    async (uri) => {
      const database = await getDb();
      const schema = database.getSchema();
      const formatted = schema.map(s => `-- Table: ${s.name}\n${s.sql};`).join('\n\n');
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/x-sql',
            text: formatted
          }
        ]
      };
    }
  );

  // ── Resource 2: Live Inventory Stats ──────────────────────────────────────
  server.resource(
    'db-stats',
    'inventory://stats',
    async (uri) => {
      const database = await getDb();
      const stats = database.getStats();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(stats, null, 2)
          }
        ]
      };
    }
  );

  // ── Prompt 1: Inventory Stock Audit ───────────────────────────────────────
  server.prompt(
    'inventory_audit',
    {
      category: z.string().optional().describe('Optional product category to filter audit')
    },
    ({ category }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please audit the inventory database${category ? ` for category '${category}'` : ''}. Identify all products where current stock_quantity is below or equal to reorder_level, list the corresponding suppliers, and recommend or execute purchase orders.`
          }
        }
      ]
    })
  );

  return { server, getDb };
}

// Start stdio transport if invoked directly as CLI script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, getDb } = createInventoryServer();
  await getDb(); // ensure seeded
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stdio transport manages stdout/stdin for JSON-RPC
}
