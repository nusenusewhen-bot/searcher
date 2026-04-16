const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

app.use(express.json());

let botUser = null;
let requestQueue = [];
let processing = false;

// Rate limit management
let lastRequest = 0;
const MIN_DELAY = 1000; // 1 second between requests to stay within limits

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
          'User-Agent': 'DiscordBot (https://github.com/discord/discord-example-app, 1.0.0)',
          'Accept': 'application/json'
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });

      req.on('error', (err) => resolve({ status: 0, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 0, error: 'timeout' });
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

// Check single username
app.get('/api/check/:username', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token configured' });
  
  const username = req.params.username.toLowerCase().replace(/\s/g, '');
  
  // Validate username format
  if (!/^[a-z0-9_.]{2,32}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username format' });
  }
  
  const result = await discordRequest(`/users/${username}`);
  
  res.json({
    username: username,
    available: result.status === 404,
    taken: result.status === 200,
    invalid: result.status === 400,
    rate_limited: result.status === 429,
    status_code: result.status,
    retry_after: result.data?.retry_after || null
  });
});

// Check multiple usernames (sequential with delays)
app.post('/api/check-batch', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token configured' });
  
  const { usernames } = req.body;
  
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: 'Provide array of usernames' });
  }
  
  if (usernames.length > 20) {
    return res.status(400).json({ error: 'Max 20 usernames per batch' });
  }
  
  const results = [];
  const startTime = Date.now();
  
  for (const user of usernames) {
    const cleanUser = user.toLowerCase().replace(/\s/g, '');
    
    if (!/^[a-z0-9_.]{2,32}$/.test(cleanUser)) {
      results.push({ username: cleanUser, error: 'Invalid format', available: false });
      continue;
    }
    
    const result = await discordRequest(`/users/${cleanUser}`);
    
    results.push({
      username: cleanUser,
      available: result.status === 404,
      taken: result.status === 200,
      status_code: result.status
    });
  }
  
  res.json({
    results: results,
    total: usernames.length,
    available_count: results.filter(r => r.available).length,
    taken_count: results.filter(r => r.taken).length,
    duration_ms: Date.now() - startTime
  });
});

// Generate username suggestions
app.get('/api/generate/:length/:count', (req, res) => {
  const length = parseInt(req.params.length) || 4;
  const count = Math.min(parseInt(req.params.count) || 10, 50);
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
  
  res.json({ usernames: names, count: names.length });
});

// Frontend
app.get('/', async (req, res) => {
  const valid = await validateToken();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Discord Username Checker</title>
      <style>
        * { box-sizing: border-box; }
        body { 
          background: #36393f; 
          color: #dcddde; 
          font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif; 
          padding: 20px; 
          max-width: 600px; 
          margin: 0 auto;
          line-height: 1.5;
        }
        .header { 
          background: #2f3136; 
          padding: 20px; 
          border-radius: 8px; 
          margin-bottom: 20px;
          border-bottom: 2px solid ${valid ? '#3ba55d' : '#ed4245'};
        }
        h1 { margin: 0 0 10px 0; font-size: 24px; color: #fff; }
        .status { 
          display: inline-block; 
          padding: 4px 12px; 
          border-radius: 12px; 
          font-size: 12px; 
          font-weight: 600;
          background: ${valid ? '#3ba55d' : '#ed4245'};
          color: #fff;
        }
        .card { 
          background: #2f3136; 
          padding: 20px; 
          border-radius: 8px; 
          margin-bottom: 15px; 
        }
        input, textarea { 
          width: 100%; 
          padding: 12px; 
          background: #40444b; 
          border: 1px solid #202225; 
          border-radius: 4px; 
          color: #dcddde;
          font-size: 14px;
          margin-bottom: 10px;
        }
        input:focus, textarea:focus {
          outline: none;
          border-color: #5865f2;
        }
        button { 
          width: 100%; 
          padding: 12px; 
          background: #5865f2; 
          color: #fff; 
          border: none; 
          border-radius: 4px; 
          font-size: 14px; 
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }
        button:hover { background: #4752c4; }
        button:disabled { background: #4f545c; cursor: not-allowed; }
        .result { 
          padding: 12px; 
          border-radius: 4px; 
          margin-top: 10px;
          font-family: monospace;
          font-size: 13px;
        }
        .available { background: rgba(59, 165, 93, 0.2); color: #3ba55d; border: 1px solid #3ba55d; }
        .taken { background: rgba(237, 66, 69, 0.2); color: #ed4245; border: 1px solid #ed4245; }
        .error { background: rgba(250, 166, 26, 0.2); color: #faa61a; border: 1px solid #faa61a; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .info { font-size: 12px; color: #72767d; margin-top: 5px; }
        #results { margin-top: 15px; }
        .loading { opacity: 0.6; pointer-events: none; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🔍 Discord Username Checker</h1>
        <span class="status">${valid ? 'Bot Connected' : 'Token Required'}</span>
        ${valid ? `<div class="info">Logged in as: ${botUser?.username || 'Unknown'}</div>` : ''}
      </div>

      ${valid ? `
      <div class="card">
        <h3 style="margin-top:0;color:#fff;">Single Check</h3>
        <input type="text" id="single" placeholder="Enter username..." maxlength="32">
        <button onclick="checkSingle()">Check Availability</button>
        <div id="single-result"></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0;color:#fff;">Batch Check (Max 20)</h3>
        <textarea id="batch" rows="4" placeholder="username1&#10;username2&#10;username3"></textarea>
        <button onclick="checkBatch()">Check All</button>
        <div id="batch-results"></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0;color:#fff;">Generate & Check</h3>
        <div class="grid">
          <input type="number" id="gen-length" placeholder="Length (2-32)" min="2" max="32" value="4">
          <input type="number" id="gen-count" placeholder="Count (max 20)" min="1" max="20" value="10">
        </div>
        <button onclick="generateAndCheck()">Generate & Check</button>
        <div id="gen-results"></div>
      </div>
      ` : `
      <div class="card">
        <p>Set <code>DISCORD_TOKEN</code> environment variable to start.</p>
        <p class="info">Create a bot at <a href="https://discord.com/developers/applications" style="color:#5865f2;">Discord Developer Portal</a></p>
      </div>
      `}

      <script>
        async function checkSingle() {
          const username = document.getElementById('single').value.trim();
          if (!username) return;
          
          const btn = document.querySelector('button');
          btn.classList.add('loading');
          
          const res = await fetch('/api/check/' + encodeURIComponent(username));
          const data = await res.json();
          
          const div = document.getElementById('single-result');
          div.className = 'result ' + (data.available ? 'available' : data.taken ? 'taken' : 'error');
          div.innerHTML = data.available ? '✅ Available' : data.taken ? '❌ Taken' : '⚠️ ' + (data.error || 'Error');
          
          btn.classList.remove('loading');
        }

        async function checkBatch() {
          const text = document.getElementById('batch').value;
          const usernames = text.split('\\n').map(s => s.trim()).filter(s => s);
          
          if (usernames.length === 0) return;
          
          const btn = document.querySelectorAll('button')[1];
          btn.classList.add('loading');
          
          const res = await fetch('/api/check-batch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({usernames})
          });
          const data = await res.json();
          
          const div = document.getElementById('batch-results');
          div.innerHTML = data.results.map(r => 
            '<div class="result ' + (r.available ? 'available' : r.taken ? 'taken' : 'error') + '">' +
            r.username + ': ' + (r.available ? 'Available' : r.taken ? 'Taken' : r.error) +
            '</div>'
          ).join('');
          
          btn.classList.remove('loading');
        }

        async function generateAndCheck() {
          const length = document.getElementById('gen-length').value;
          const count = document.getElementById('gen-count').value;
          
          const res = await fetch('/api/generate/' + length + '/' + count);
          const data = await res.json();
          
          document.getElementById('batch').value = data.usernames.join('\\n');
          checkBatch();
        }
      </script>
    </body>
    </html>
  `);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    token_set: !!TOKEN,
    timestamp: new Date().toISOString()
  });
});

// Start
validateToken().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Token status: ${TOKEN ? 'Set' : 'Missing'}`);
  });
});
