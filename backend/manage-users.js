const readline = require('readline');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, 'users.json');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function hashUsername(name) {
    return crypto.createHash('sha256').update(name).digest('hex');
}

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log('--- GaffBuster User Manager ---');
    
    const username = await question('Enter username: ');
    if (!username) {
        console.log('Error: Username cannot be empty.');
        process.exit(1);
    }

    const password = await question('Enter password: ');
    if (!password) {
        console.log('Error: Password cannot be empty.');
        process.exit(1);
    }

    let users = {};
    if (fs.existsSync(usersPath)) {
        users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    }

    console.log(`\nSecuring credentials for "${username}"...`);
    const userHash = hashUsername(username);
    const passHash = await bcrypt.hash(password, 10);

    users[userHash] = passHash;

    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    
    console.log('Success! User added/updated.');
    console.log('Remember to run "make restart" to apply changes if the service is running.');
    rl.close();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
