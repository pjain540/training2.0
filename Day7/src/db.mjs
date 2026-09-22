import initSqlJs from 'sql.js';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DB_DIR = join(__dirname, '../data');
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, 'inventory.db');

let SQL = null;

async function getSqlJs() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

/**
 * Real SQLite database manager backed by WebAssembly sql.js with file persistence.
 */
export class InventoryDatabase {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    const sqlEngine = await getSqlJs();

    const dir = dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new sqlEngine.Database(buffer);
    } else {
      this.db = new sqlEngine.Database();
      this._seedInitialData();
      this.persist();
    }
    return this;
  }

  _seedInitialData() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        phone TEXT
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sku TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        stock_quantity INTEGER NOT NULL,
        reorder_level INTEGER NOT NULL,
        supplier_id INTEGER,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        supplier_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      );
    `);

    // Insert suppliers
    this.db.run(`
      INSERT INTO suppliers (id, name, contact_email, phone) VALUES
      (1, 'Apex Optics Ltd', 'procurement@apexoptics.com', '+1-555-0192'),
      (2, 'Quantum MicroTech', 'orders@quantummicro.io', '+1-555-0143'),
      (3, 'Titanium Industrial Supply', 'support@titaniumind.com', '+1-555-0188');
    `);

    // Insert products (note: Optical Sensor and Thermal Core are below reorder_level)
    this.db.run(`
      INSERT INTO products (id, name, sku, category, price, stock_quantity, reorder_level, supplier_id) VALUES
      (1, 'Nebula Optical Sensor v3', 'OPT-SENS-003', 'Sensors', 149.99, 3, 10, 1),
      (2, 'Precision LiDAR Scanner', 'LID-SCAN-012', 'Sensors', 899.00, 14, 5, 1),
      (3, 'Quantum Sub-Processor Q1', 'CPU-Q1-88', 'Compute', 450.50, 22, 10, 2),
      (4, 'Thermal Core Radiator', 'THM-RAD-04', 'Thermal', 79.95, 2, 8, 3),
      (5, 'Ultra-Capacitor Bank 500F', 'CAP-BNK-500', 'Power', 120.00, 35, 15, 3);
    `);

    // Insert initial completed order
    this.db.run(`
      INSERT INTO orders (id, product_id, supplier_id, quantity, unit_price, status, created_at) VALUES
      (1, 2, 1, 5, 899.00, 'COMPLETED', '2026-09-01T10:00:00Z');
    `);
  }

  persist() {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  getSchema() {
    const res = this.db.exec(`
      SELECT name, sql 
      FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC;
    `);

    if (!res.length) return [];
    const columns = res[0].columns;
    return res[0].values.map(row => {
      const obj = {};
      columns.forEach((col, idx) => { obj[col] = row[idx]; });
      return obj;
    });
  }

  getStats() {
    const productStats = this.db.exec(`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN stock_quantity <= reorder_level THEN 1 ELSE 0 END) as low_stock_count,
        ROUND(AVG(price), 2) as avg_price,
        SUM(stock_quantity) as total_units_in_stock
      FROM products;
    `);

    const orderStats = this.db.exec(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_orders
      FROM orders;
    `);

    const supplierStats = this.db.exec(`
      SELECT COUNT(*) as total_suppliers FROM suppliers;
    `);

    const parseRow = (execRes) => {
      if (!execRes.length) return {};
      const cols = execRes[0].columns;
      const vals = execRes[0].values[0];
      const obj = {};
      cols.forEach((col, idx) => { obj[col] = vals[idx]; });
      return obj;
    };

    return {
      products: parseRow(productStats),
      orders: parseRow(orderStats),
      suppliers: parseRow(supplierStats)
    };
  }

  query(sql, params = []) {
    // Safety check: ensure read-only query
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('PRAGMA') && !trimmed.startsWith('EXPLAIN')) {
      throw new Error('db_query only allows read queries (SELECT, PRAGMA). For modifications, use db_execute.');
    }

    try {
      const stmt = this.db.prepare(sql);
      if (params && params.length > 0) {
        stmt.bind(params);
      }

      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      throw new Error(`SQL Query Error: ${err.message}`);
    }
  }

  execute(sql, params = []) {
    // Safety check: prevent destructive statements
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('DROP TABLE') || trimmed.includes('DROP DATABASE')) {
      throw new Error('Destructive operations (DROP TABLE) are disallowed by database policy.');
    }

    try {
      this.db.run(sql, params);
      this.persist();

      const lastIdRes = this.db.exec('SELECT last_insert_rowid() as id;');
      const lastInsertId = lastIdRes[0]?.values[0]?.[0] ?? null;
      const rowsAffected = this.db.getRowsModified();

      return {
        success: true,
        lastInsertId,
        rowsAffected
      };
    } catch (err) {
      throw new Error(`SQL Execution Error: ${err.message}`);
    }
  }

  reset() {
    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }
    return this.init();
  }
}
