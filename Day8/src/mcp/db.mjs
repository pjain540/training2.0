import initSqlJs from 'sql.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OperationsDatabase {
  constructor(dbPath = join(__dirname, '../../data/operations.db')) {
    this.dbPath = dbPath;
    this.db = null;
    this.SQL = null;
  }

  async init() {
    if (this.db) return this;

    this.SQL = await initSqlJs();

    if (existsSync(this.dbPath)) {
      const buffer = await readFile(this.dbPath);
      this.db = new this.SQL.Database(buffer);
    } else {
      this.db = new this.SQL.Database();
      this.seedInitialSchema();
      await this.persist();
    }

    return this;
  }

  seedInitialSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tier TEXT NOT NULL CHECK(tier IN ('Starter', 'Professional', 'Enterprise')),
        monthly_spend REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('P1', 'P2', 'P3')),
        service_impact_minutes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('OPEN', 'INVESTIGATING', 'PENDING_APPROVAL', 'RESOLVED', 'REJECTED')),
        remediation_action TEXT,
        credit_awarded REAL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_number TEXT NOT NULL,
        action_type TEXT NOT NULL,
        details TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);

    // Insert initial seed records
    this.db.run(`
      INSERT INTO customers (id, name, tier, monthly_spend, status) VALUES
        (1, 'Acme Global Corp', 'Enterprise', 4500.00, 'ACTIVE'),
        (2, 'Nexus Financial', 'Enterprise', 8200.00, 'ACTIVE'),
        (3, 'QuickByte Media', 'Professional', 750.00, 'ACTIVE');

      INSERT INTO incidents (id, ticket_number, customer_id, title, severity, service_impact_minutes, status, created_at) VALUES
        (1, 'INC-8091', 1, 'Database latency spike > 350ms causing checkout timeouts for 90 minutes', 'P1', 90, 'OPEN', '2026-09-23T10:00:00Z'),
        (2, 'INC-8092', 2, 'API rate limiter misconfiguration during scheduled deployment', 'P2', 25, 'OPEN', '2026-09-23T11:30:00Z');
    `);
  }

  async persist() {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    await mkdir(dirname(this.dbPath), { recursive: true });
    await writeFile(this.dbPath, buffer);
  }

  query(sql, params = []) {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  execute(sql, params = []) {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    this.db.run(sql, params);
    const lastId = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] ?? null;
    const changes = this.db.getRowsModified();
    // Fire-and-forget async persist
    this.persist().catch(err => console.error('DB persist error:', err));
    return { lastInsertId: lastId, rowsAffected: changes };
  }

  getSchema() {
    if (!this.db) throw new Error('Database not initialized.');
    const tables = this.query(
      `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    return tables;
  }
}
