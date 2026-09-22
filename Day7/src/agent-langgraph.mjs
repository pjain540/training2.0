/**
 * Day 7 — LangGraph Agent Powered by MCP Tools & Resources
 *
 * Integrates the Day 6 StateGraph multi-agent architecture with Day 7 MCP client:
 *   [START]
 *      ↓
 *  [inspector]   <-- reads MCP resources (inventory://schema, inventory://stats)
 *      ↓
 *   [auditor]    <-- calls MCP tool: db_query (detects low stock items)
 *      ↓
 *  [restocker]   <-- calls MCP tool: db_execute (places purchase order)
 *      ↓
 *  [verifier]    <-- calls MCP tool: db_query (confirms order persistence)
 *      ↓
 *    [END]
 */

import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { MCPClientBridge } from './mcp-client.mjs';

export const MCPAgentState = Annotation.Root({
  task: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => 'Audit inventory and restock depleted items'
  }),
  schema: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => ''
  }),
  systemStats: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => ({})
  }),
  lowStockItems: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => []
  }),
  placedOrders: Annotation({
    reducer: (curr, update) => (update ? [...curr, ...update] : curr),
    default: () => []
  }),
  verifiedOrders: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => []
  }),
  logs: Annotation({
    reducer: (curr, update) => (update ? [...curr, ...(Array.isArray(update) ? update : [update])] : curr),
    default: () => []
  }),
  completed: Annotation({
    reducer: (curr, update) => (update !== undefined ? update : curr),
    default: () => false
  })
});

export function createMCPLangGraphAgent({ mcpBridge = null } = {}) {
  const bridge = mcpBridge || new MCPClientBridge();

  // Node 1: Inspector (Reads MCP Resources)
  const inspectorNode = async (state) => {
    await bridge.connect();
    const statsResource = await bridge.readResource('inventory://stats');
    const stats = JSON.parse(statsResource.contents[0].text);

    return {
      systemStats: stats,
      logs: [`[Inspector]: Fetched MCP Resource inventory://stats (${stats.products.low_stock_count} items low in stock)`]
    };
  };

  // Node 2: Auditor (Invokes MCP Tool db_query)
  const auditorNode = async (state) => {
    const queryResult = await bridge.callTool('db_query', {
      sql: `
        SELECT p.id, p.name, p.sku, p.stock_quantity, p.reorder_level, p.price, p.supplier_id, s.name as supplier_name
        FROM products p
        JOIN suppliers s ON p.supplier_id = s.id
        WHERE p.stock_quantity <= p.reorder_level
      `
    });

    const parsed = JSON.parse(queryResult.content);
    const lowStock = parsed.rows || [];

    return {
      lowStockItems: lowStock,
      logs: [`[Auditor]: Executed MCP tool db_query -> Found ${lowStock.length} items needing reorder.`]
    };
  };

  // Node 3: Restocker (Invokes MCP Tool db_execute for each needed restock)
  const restockerNode = async (state) => {
    const ordersPlaced = [];
    const now = new Date().toISOString();

    for (const item of state.lowStockItems) {
      const orderQty = (item.reorder_level * 2) - item.stock_quantity;
      const execResult = await bridge.callTool('db_execute', {
        sql: `INSERT INTO orders (product_id, supplier_id, quantity, unit_price, status, created_at) VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        params: [item.id, item.supplier_id, orderQty, item.price, now]
      });

      const parsed = JSON.parse(execResult.content);
      ordersPlaced.push({
        orderId: parsed.lastInsertId,
        productName: item.name,
        supplierName: item.supplier_name,
        quantity: orderQty,
        totalCost: (orderQty * item.price).toFixed(2)
      });
    }

    return {
      placedOrders: ordersPlaced,
      logs: [`[Restocker]: Executed MCP tool db_execute -> Placed ${ordersPlaced.length} restock purchase order(s).`]
    };
  };

  // Node 4: Verifier (Invokes MCP Tool db_query to verify persistence)
  const verifierNode = async (state) => {
    const verifyResult = await bridge.callTool('db_query', {
      sql: `
        SELECT o.id, p.name as product_name, s.name as supplier_name, o.quantity, o.status, o.created_at
        FROM orders o
        JOIN products p ON o.product_id = p.id
        JOIN suppliers s ON o.supplier_id = s.id
        ORDER BY o.id DESC
        LIMIT 5
      `
    });

    const parsed = JSON.parse(verifyResult.content);

    return {
      verifiedOrders: parsed.rows || [],
      completed: true,
      logs: [`[Verifier]: Confirmed order records via MCP tool db_query. Task complete.`]
    };
  };

  const workflow = new StateGraph(MCPAgentState)
    .addNode('inspector', inspectorNode)
    .addNode('auditor', auditorNode)
    .addNode('restocker', restockerNode)
    .addNode('verifier', verifierNode)
    .addEdge(START, 'inspector')
    .addEdge('inspector', 'auditor')
    .addEdge('auditor', 'restocker')
    .addEdge('restocker', 'verifier')
    .addEdge('verifier', END);

  const app = workflow.compile();

  return {
    app,
    bridge,
    execute: async (initialState = {}) => {
      const result = await app.invoke(initialState);
      return result;
    }
  };
}
