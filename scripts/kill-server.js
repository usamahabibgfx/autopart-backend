const { exec } = require('child_process');

exec('netstat -ano | findstr :5000', (err, stdout, stderr) => {
    if (err) {
        console.error('Error finding process on port 5000:', err);
        return;
    }

    const lines = stdout.split('\n');
    const line = lines.find(l => l.includes('LISTENING'));

    if (!line) {
        console.log('No process found listening on port 5000.');
        return;
    }

    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];

    if (!pid || isNaN(pid)) {
        console.log('Could not parse PID from line:', line);
        return;
    }

    console.log(`Found process ${pid} listening on port 5000. Killing it...`);

    exec(`taskkill /F /PID ${pid}`, (killErr, killStdout, killStderr) => {
        if (killErr) {
            console.error('Error killing process:', killErr);
            return;
        }
        console.log('Process killed successfully.');
    });
});
