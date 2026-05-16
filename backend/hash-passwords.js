const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, 'users.json');

if (!fs.existsSync(usersPath)) {
    console.log('Error: users.json not found in backend directory.');
    process.exit(1);
}

const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
const saltRounds = 10;

function hashUsername(name) {
    return crypto.createHash('sha256').update(name).digest('hex');
}

async function hashAll() {
    const newUsers = {};
    let count = 0;

    for (const [key, value] of Object.entries(users)) {
        // If the key is already a 64-char hex string (SHA-256) AND the value is a bcrypt hash
        // then we assume it's already processed.
        const isKeyHashed = /^[a-f0-9]{64}$/.test(key);
        const isValueHashed = value.startsWith('$2b$') || value.startsWith('$2a$');

        if (isKeyHashed && isValueHashed) {
            console.log(`Entry with hash starting "${key.substring(0, 8)}..." is already secured. Skipping.`);
            newUsers[key] = value;
            continue;
        }

        console.log(`Securing credentials for user: ${key}...`);
        const userHash = hashUsername(key);
        const passHash = await bcrypt.hash(value, saltRounds);
        newUsers[userHash] = passHash;
        count++;
    }
    
    fs.writeFileSync(usersPath, JSON.stringify(newUsers, null, 2));
    console.log(`\nSuccess! ${count} new user(s) secured in users.json.`);
    console.log('Usernames are now SHA-256 hashes and passwords are bcrypt hashes.');
    console.log('IMPORTANT: Restart containers with "make restart" to apply changes.');
}

hashAll().catch(err => {
    console.error('Error during hashing:', err);
    process.exit(1);
});
