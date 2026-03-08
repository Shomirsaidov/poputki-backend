const Database = require('better-sqlite3');
const db = new Database('poputki.db');

console.log('Users:');
try {
    const users = db.prepare('SELECT * FROM users LIMIT 5').all();
    console.log(JSON.stringify(users, null, 2));
} catch (e) {
    console.error('Error selecting users:', e.message);
}

console.log('Schema info for users:');
try {
    const schema = db.prepare("PRAGMA table_info(users)").all();
    console.log(JSON.stringify(schema, null, 2));
} catch (e) {
    console.error('Error getting schema:', e.message);
}
