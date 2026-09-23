#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { OperationsDatabase } from './db.mjs';

export function createOperationsServer(dbInstanceOrPath) {
  let db;
  let initPromise = null;

  async function getDb() {
    if (db) return db;
    if (dbInstanceOrPath instanceof OperationsDatabase) {
      db = dbInstanceOrPath;
      await db.init();
      return db;
    }
    if (!initPromise) {
      const dbInstance = new OperationsDatabase(
        typeof dbInstanceOrPath === 'string' ? dbInstanceOrPath : undefined
      );
      initPromise = dbInstance.init().then(d => {
        db = d;
        return d;
      });
    }
    return initPromise;
  }

  const server = new McpServer({
    name: 'enterprise-ops-mcp',
    version: '1.0.0'
  });

  // ── Tool 1: Query System & Customer State ────────────────────────────────
  server.tool(
    'query_system_state',
    'Execute a read-only query to inspect incidents, customer contracts, and audit trails',
    {
      sql: z.string().describe('The read-only SELECT SQL statement'),
      params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
    },
    async ({ sql, params = [] }) => {
      try {
        const database = await getDb();
        const trimmed = sql.trim().toLowerCase();
        if (!trimmed.startsWith('select') && !trimmed.startsWith('pragma')) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Security error: Only SELECT queries are permitted on query_system_state.' }]
          };
        }
        const rows = database.query(sql, params);
        return {
          content: [{ type: 'text', text: JSON.stringify({ count: rows.length, rows }, null, 2) }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Query execution failed: ${err.message}` }]
        };
      }
    }
  );

  // ── Tool 2: Execute Resolution Action (State Mutation) ─────────────────────
  server.tool(
    'execute_resolution_action',
    'Execute an approved resolution remediation (updates ticket status, grants SLA credit, or triggers pool scale)',
    {
      ticketNumber: z.string().describe('Ticket identifier (e.g., INC-8091)'),
      actionType: z.enum(['APPLY_SLA_CREDIT', 'SCALE_READ_REPLICA', 'CLOSE_INCIDENT', 'REJECT_CLAIM']).describe('The authorized action type'),
      creditAmount: z.number().optional().describe('Monetary credit amount awarded if applicable'),
      notes: z.string().describe('Resolution notes and reason'),
      approvedBy: z.string().describe('Operator ID who authorized the action')
    },
    async ({ ticketNumber, actionType, creditAmount = 0.0, notes, approvedBy }) => {
      try {
        const database = await getDb();
        const now = new Date().toISOString();

        // 1. Update incident
        const updateSql = `
          UPDATE incidents
          SET status = ?, remediation_action = ?, credit_awarded = ?
          WHERE ticket_number = ?
        `;
        const newStatus = actionType === 'REJECT_CLAIM' ? 'REJECTED' : 'RESOLVED';
        const actionSummary = `${actionType}: ${notes} (Approved by: ${approvedBy})`;
        const res = database.execute(updateSql, [newStatus, actionSummary, creditAmount, ticketNumber]);

        // 2. Append immutable audit trail
        database.execute(
          `INSERT INTO audit_logs (ticket_number, action_type, details, approved_by, executed_at, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [ticketNumber, actionType, notes, approvedBy, now, 'COMMITTED']
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              ticketNumber,
              actionType,
              status: newStatus,
              creditAwarded: creditAmount,
              approvedBy,
              timestamp: now,
              rowsUpdated: res.rowsAffected
            }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Action execution failed: ${err.message}` }]
        };
      }
    }
  );

  // ── Tool 3: Record Audit Log ──────────────────────────────────────────────
  server.tool(
    'record_audit_log',
    'Record an entry into the compliance audit log',
    {
      ticketNumber: z.string(),
      actionType: z.string(),
      details: z.string(),
      approvedBy: z.string()
    },
    async ({ ticketNumber, actionType, details, approvedBy }) => {
      try {
        const database = await getDb();
        const now = new Date().toISOString();
        const res = database.execute(
          `INSERT INTO audit_logs (ticket_number, action_type, details, approved_by, executed_at, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [ticketNumber, actionType, details, approvedBy, now, 'LOGGED']
        );
        return {
          content: [{ type: 'text', text: JSON.stringify({ auditLogId: res.lastInsertId, timestamp: now }, null, 2) }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Audit recording failed: ${err.message}` }]
        };
      }
    }
  );

  // ── Resource: Active Incidents ───────────────────────────────────────────
  server.resource(
    'active-incidents',
    'incident://active',
    async (uri) => {
      const database = await getDb();
      const rows = database.query(`
        SELECT i.ticket_number, c.name as customer_name, c.tier, i.title, i.severity, i.service_impact_minutes, i.status
        FROM incidents i
        JOIN customers c ON i.customer_id = c.id
        WHERE i.status != 'RESOLVED'
      `);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(rows, null, 2)
        }]
      };
    }
  );

  // ── Resource: Audit Log ──────────────────────────────────────────────────
  server.resource(
    'audit-log',
    'audit://log',
    async (uri) => {
      const database = await getDb();
      const rows = database.query(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10`);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(rows, null, 2)
        }]
      };
    }
  );

  return { server, getDb };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, getDb } = createOperationsServer();
  await getDb();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
