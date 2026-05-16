const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, 'users.json');

if (!fs.existsSync(usersPath)) {
    console.log('Error: users.json not found in backend directory.');
    process.exit(1);
}

const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
const saltRounds = 10;

async function hashPasswords() {
    const hashedUsers = {};
    for (const [username, password] of Object.entries(users)) {
        // Check if already hashed (bcrypt hashes start with $2b$ or $2a$)
        if (password.startsWith('$2b$') || password.startsWith('$2a$')) {
            console.log(`User "${username}" already has a hashed password. Skipping.`);
            hashedUsers[username] = password;
            continue;
        }
        
        console.log(`Hashing password for user: ${username}...`);
        const hashed = await bcrypt.hash(password, saltRounds);
        hashedUsers[username] = hashed;
    }
    
    fs.writeFileSync(usersPath, JSON.stringify(hashedUsers, null, 2));
    console.log('\nSuccess! users.json has been updated with hashed passwords.');
    console.log('IMPORTANT: Please restart your containers with "make restart" to apply changes.');
}

hashPasswords().catch(err => {
    console.error('Error hashing passwords:', err);
    process.exit(1);
});
