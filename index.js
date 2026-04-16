const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

app.use(express.json());

let botUser = null;
let lastRequest = 0;
const MIN_DELAY = 1000;

async function discordRequest(path) {
  return new Promise((resolve) => {
    const now = Date.now();
    const wait = Math.max(0, MIN_DELAY - (now - lastRequest));
    
    setTimeout(() => {
      lastRequest = Date.now();
      
      const options = {
        hostname: 'discord.com',
        port: 443,
        path: `/api/v10${path}`,
        method: 'GET',
        headers: {
          'Authorization': TOKEN,
          'User-Agent': 'DiscordBot (1.0.0)',
          'Accept': 'application/json'
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsedData = {};
          if (data && data.trim()) {
            try {
              parsedData = JSON.parse(data);
            } catch (e) {
              parsedData = { message: data };
            }
          }
          
          resolve({ 
            status: res.statusCode, 
            data: parsedData
          });
        });
      });

      req.on('error', (err) => resolve({ status: 0, error: err.message, data: {} }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 0, error: 'timeout', data: {} });
      });
      req.end();
    }, wait);
  });
}

async function validateToken() {
  if (!TOKEN) return false;
  const result = await discordRequest('/users/@me');
  if (result.status === 200) {
    botUser = result.data;
    return true;
  }
  return false;
}

app.get('/api/check/:username', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const username = req.params.username.toLowerCase().trim();
  
  if (!username || !/^[a-z0-9_.]{2,32}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username format', username });
  }
  
  const result = await discordRequest(`/users/${username}`);
  
  res.json({
    username: username,
    available: result.status === 404,
    taken: result.status === 200,
    status_code: result.status,
    error: result.error || null
  });
});

app.post('/api/check-batch', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const { usernames } = req.body;
  
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: 'Provide usernames array' });
  }
  
  if (usernames.length > 20) {
    return res.status(400).json({ error: 'Max 20 usernames' });
  }
  
  const results = [];
  
  for (const user of usernames) {
    const cleanUser = user.toLowerCase().trim();
    
    if (!/^[a-z0-9_.]{2,32}$/.test(cleanUser)) {
      results.push({ 
        username: cleanUser, 
        available: false, 
        taken: false, 
        error: 'Invalid format',
        status_code: 400
      });
      continue;
    }
    
    const result = await discordRequest(`/users/${cleanUser}`);
    
    results.push({
      username: cleanUser,
      available: result.status === 404,
      taken: result.status === 200,
      status_code: result.status,
      error: result.error || null
    });
  }
  
  res.json({
    results: results,
    total: usernames.length,
    available_count: results.filter(r => r.available).length,
    taken_count: results.filter(r => r.taken).length
  });
});

app.get('/api/generate/:length/:count', (req, res) => {
  const length = parseInt(req.params.length) || 4;
  const count = Math.min(parseInt(req.params.count) || 10, 20);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  
  const names = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    const nameLength = length === 0 ? 2 + Math.floor(Math.random() * 5) : length;
    for (let j = 0; j < nameLength; j++) {
      name += chars[Math.floor(Math.random() * chars.length)];
    }
    names.push(name);
  }
  
  res.json({ usernames: names });
});

app.get('/', async (req, res) => {
  const valid = await validateToken();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Username Checker</title>
      <style>
        body { 
          background: #1a1a1a; 
          color: #fff; 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          padding: 20px; 
          max-width: 600px; 
          margin: 0 auto;
        }
        .header { 
          background: #2d2d2d; 
          padding: 20px; 
          border-radius: 12px; 
          margin-bottom: 20px;
          border-left: 4px solid ${valid ? '#4caf50' : '#f44336'};
        }
        h1 { margin: 0; font-size: 24px; }
        .status { 
          display: inline-block; 
          margin-top: 10px;
          padding: 6px 12px; 
          border-radius: 20px; 
          font-size: 12px; 
          font-weight: 600;
          background: ${valid ? '#4caf50' : '#f44336'};
        }
        .card { 
          background: #2d2d2d; 
          padding: 20px; 
          border-radius: 12px; 
          margin-bottom: 15px; 
        }
        input, textarea { 
          width: 100%; 
          padding: 12px; 
          background: #1a1a1a; 
          border: 1px solid #444; 
          border-radius: 8px; 
          color: #fff;
          font-size: 14px;
          margin-bottom: 10px;
          box-sizing: border-box;
        }
        button { 
          width: 100%; 
          padding: 14px; 
          background: #5865f2; 
          color: #fff; 
          border: none; 
          border-radius: 8px; 
          font-size: 14px; 
          font-weight: 600;
          cursor: pointer;
        }
        button:hover { background: #4752c4; }
        button:disabled { background: #444; cursor: not-allowed; }
        .result { 
          padding: 12px; 
          border-radius: 8px; 
          margin-top: 10px;
          font-family: monospace;
          font-size: 13px;
        }
        .available { background: rgba(76, 175, 80, 0.2); color: #4caf50; border: 1px solid #4caf50; }
        .taken { background: rgba(244, 67, 54, 0.2); color: #f44336; border: 1px solid #f44336; }
        .error { background: rgba(255, 152, 0, 0.2); color: #ff9800; border: 1px solid #ff9800; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .loading { opacity: 0.5; pointer-events: none; }
        h3 { margin-top: 0; color: #fff; }
        .info { font-size: 12px; color: #888; margin-top: 5px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🔍 Username Checker</h1>
        <span class="status">${valid ? 'Connected' : 'Token Required'}</span>
        ${valid ? `<div class="info">Bot: ${botUser?.username || 'Unknown'}</div>` : ''}
      </div>

      ${valid ? `
      <div class="card">
        <h3>Single Check</h3>
        <input type="text" id="single" placeholder="Enter username..." maxlength="32">
        <button onclick="checkSingle()" id="btn-single">Check</button>
        <div id="single-result"></div>
      </div>

      <div class="card">
        <h3>Batch Check</h3>
        <textarea id="batch" rows="4" placeholder="username1&#10;username2&#10;username3"></textarea>
        <button onclick="checkBatch()" id="btn-batch">Check All</button>
        <div id="batch-results"></div>
      </div>

      <div class="card">
        <h3>Generate & Check</h3>
        <div class="grid">
          <input type="number" id="gen-length" placeholder="Length" min="2" max="32" value="4">
          <input type="number" id="gen-count" placeholder="Count" min="1" max="20" value="5">
        </div>
        <button onclick="generateAndCheck()" id="btn-gen">Generate & Check</button>
        <div id="gen-results"></div>
      </div>
      ` : `
      <div class="card">
        <p>Set <code>DISCORD_TOKEN</code> environment variable to start.</p>
      </div>
      `}

      <script>
        async function checkSingle() {
          const username = document.getElementById('single').value.trim();
          if (!username) return;
          
          const btn = document.getElementById('btn-single');
          const div = document.getElementById('single-result');
          btn.classList.add('loading');
          div.innerHTML = 'Checking...';
          
          try {
            const res = await fetch('/api/check/' + encodeURIComponent(username));
            const data = await res.json();
            
            div.className = 'result ' + (data.available ? 'available' : data.taken ? 'taken' : 'error');
            div.innerHTML = '<strong>' + data.username + '</strong>: ' + 
              (data.available ? '✅ AVAILABLE' : data.taken ? '❌ TAKEN' : '⚠️ ERROR: ' + (data.error || data.status_code));
          } catch (e) {
            div.className = 'result error';
            div.innerHTML = 'Request failed';
          }
          
          btn.classList.remove('loading');
        }

        async function checkBatch() {
          const text = document.getElementById('batch').value;
          const usernames = text.split('\\n').map(s => s.trim()).filter(s => s);
          
          if (usernames.length === 0) return;
          
          const btn = document.getElementById('btn-batch');
          const div = document.getElementById('batch-results');
          btn.classList.add('loading');
          div.innerHTML = 'Checking ' + usernames.length + ' usernames...';
          
          try {
            const res = await fetch('/api/check-batch', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({usernames})
            });
            const data = await res.json();
            
            div.innerHTML = '<div style="margin-bottom:10px;"><strong>Results:</strong> ' + 
              data.available_count + ' available, ' + data.taken_count + ' taken</div>' +
              data.results.map(r => 
                '<div class="result ' + (r.available ? 'available' : r.taken ? 'taken' : 'error') + '" style="margin-bottom:5px;">' +
                r.username + ': ' + (r.available ? '✅' : r.taken ? '❌' : '⚠️') +
                '</div>'
              ).join('');
          } catch (e) {
            div.innerHTML = 'Request failed: ' + e.message;
          }
          
          btn.classList.remove('loading');
        }

        async function generateAndCheck() {
          const length = document.getElementById('gen-length').value;
          const count = document.getElementById('gen-count').value;
          
          const btn = document.getElementById('btn-gen');
          const div = document.getElementById('gen-results');
          btn.classList.add('loading');
          div.innerHTML = 'Generating...';
          
          try {
            const res = await fetch('/api/generate/' + length + '/' + count);
            const data = await res.json();
            
            document.getElementById('batch').value = data.usernames.join('\\n');
            checkBatch();
          } catch (e) {
            div.innerHTML = 'Failed';
            btn.classList.remove('loading');
          }
        }
        
        // Enter key support
        document.getElementById('single')?.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') checkSingle();
        });
      </script>
    </body>
    </html>
  `);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', token_set: !!TOKEN });
});

validateToken().then(() => {
  app.listen(PORT, () => {
    console.log(`Server on port ${PORT} | Token: ${TOKEN ? 'OK' : 'MISSING'}`);
  });
});
