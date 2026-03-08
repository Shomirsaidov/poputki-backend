const Database = require('better-sqlite3');
const db = new Database('poputki.db');

console.log('Attempting to add created_at column...');
try {
    db.exec("ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;");
    console.log('Success!');
} catch (e) {
    console.error('Error adding column:', e.message);
}

console.log('Schema info for users after attempt:');
const schema = db.prepare("PRAGMA table_info(users)").all();
console.log(JSON.stringify(schema, null, 2));
