const readline = require('readline');
const { Writable } = require('stream');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, 'users.json');

function hashUsername(name) {
    return crypto.createHash('sha256').update(name).digest('hex');
}

/**
 * A specialized function to ask a question with masked output.
 * Uses a muted stream to prevent character leaking.
 */
function ask(query, hidden = false) {
    return new Promise((resolve) => {
        const mutableStdout = new Writable({
            write: function(chunk, encoding, callback) {
                if (!this.muted) {
                    process.stdout.write(chunk, encoding);
                } else {
                    const str = chunk.toString();
                    // Allow newlines/carriage returns to pass through
                    if (str === '\r\n' || str === '\n' || str === '\r') {
                        process.stdout.write(str);
                    } else if (hidden && process.stdin.isTTY) {
                        // Mask input characters with '*' if hidden and in TTY
                        // We use the length of the string to handle potential multi-char inputs (pasted)
                        process.stdout.write('*'.repeat(str.length));
                    }
                }
                callback();
            }
        });

        mutableStdout.muted = false;

        const rl = readline.createInterface({
            input: process.stdin,
            output: mutableStdout,
            terminal: true
        });

        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });

        // Mute after the prompt is written
        if (hidden && process.stdin.isTTY) {
            mutableStdout.muted = true;
        }
    });
}

async function main() {
    console.log('--- GaffBuster User Manager ---');
    
    let username = process.argv[2];
    let password = process.argv[3];

    if (!username) {
        username = await ask('Enter username: ');
    } else {
        console.log(`Username: ${username}`);
    }

    if (!username) {
        console.log('Error: Username cannot be empty.');
        process.exit(1);
    }

    if (!password) {
        password = await ask('Enter password: ', true);
    } else {
        console.log('Password: [PROVIDED VIA ARGUMENT]');
    }

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
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
