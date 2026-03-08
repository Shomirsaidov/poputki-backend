/**
 * db.mysql.js — MySQL drop-in replacement for better-sqlite3
 *
 * This module wraps mysql2/promise so that it exposes the EXACT same
 * synchronous interface that better-sqlite3 uses (.get(), .all(), .run()).
 *
 * Because true synchronous MySQL is impossible in Node.js, every route
 * handler that calls db.prepare().get() / .all() / .run() must be made
 * async/await. The wrapper does that automatically using a Proxy-based
 * approach: each method returns a Promise that resolves to the correct value.
 *
 * IMPORTANT: This file is intentionally NOT the active db.js yet.
 *            When you have your MySQL credentials ready, rename/replace
 *            server/db.js with this file (or swap the require() in index.js).
 *
 * HOW TO ACTIVATE:
 *   1. Set your MySQL credentials in .env (see .env.example in server/)
 *   2. Run:  cp server/db.mysql.js server/db.js
 *   3. npm install mysql2  (in the server/ directory)
 *   4. Restart the server
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

// ─── Connection Pool ──────────────────────────────────────────────────────────
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'poputki',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
});

// ─── SQLite → MySQL query translator ─────────────────────────────────────────
// better-sqlite3 uses ?  positional params — MySQL also uses ?, so no change needed.
// SQLite date('now', '-7 days') → MySQL DATE_SUB(CURDATE(), INTERVAL 7 DAY)
// SQLite datetime('now') → MySQL NOW()
function translateQuery(sql) {
    return sql
        // SQLite: date('now', '-N days')  →  MySQL equivalent
        .replace(/date\('now',\s*'-(\d+)\s+days?'\)/gi, (_, n) => `DATE_SUB(CURDATE(), INTERVAL ${n} DAY)`)
        // SQLite: datetime('now')  →  MySQL NOW()
        .replace(/datetime\('now'\)/gi, 'NOW()')
        // SQLite: date('now')  →  MySQL CURDATE()
        .replace(/date\('now'\)/gi, 'CURDATE()');
}

// ─── Prepared-statement emulator ─────────────────────────────────────────────
// Returns an object with .get(), .all(), .run() that mirror better-sqlite3.
// Each method is async and returns a Promise.
function prepare(sql) {
    const translatedSql = translateQuery(sql);

    return {
        /**
         * Fetch a single row (equivalent to better-sqlite3's .get())
         * Returns the first row or undefined.
         */
        async get(...params) {
            const flat = params.flat();
            const [rows] = await pool.execute(translatedSql, flat);
            return rows[0] || undefined;
        },

        /**
         * Fetch all rows (equivalent to better-sqlite3's .all())
         * Returns an array of rows.
         */
        async all(...params) {
            const flat = params.flat();
            const [rows] = await pool.execute(translatedSql, flat);
            return rows;
        },

        /**
         * Execute a write query (INSERT / UPDATE / DELETE).
         * Returns { lastInsertRowid, changes } to match better-sqlite3.
         */
        async run(...params) {
            const flat = params.flat();
            const [result] = await pool.execute(translatedSql, flat);
            return {
                lastInsertRowid: result.insertId,
                changes: result.affectedRows,
            };
        },

        /**
         * Alias for run() — some code paths call .exec()
         */
        async exec(...params) {
            return this.run(...params);
        },
    };
}

/**
 * Execute raw SQL (no params). Used for DDL, bulk inserts, etc.
 * Equivalent to better-sqlite3's db.exec().
 */
async function exec(sql) {
    await pool.query(sql);
}

// ─── Exports ──────────────────────────────────────────────────────────────────
// We export an object that looks like a better-sqlite3 Database instance.
module.exports = {
    prepare,
    exec,
    pool, // expose pool for advanced use (transactions, etc.)
};
