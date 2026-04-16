const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

app.use(express.json());
app.use(express.static('public'));

let botUser = null;
let checking = false;
let checkCount = 0;
let foundUsernames = [];

function apiRequest(path) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10${path}`,
      method: 'GET',
      headers: {
        'Authorization': TOKEN,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } 
        catch { resolve({ status: res.statusCode, data }); }
      });
    });

    req.on('error', () => resolve({ status: 0, error: true }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, error: true }); });
    req.end();
  });
}

async function validateToken() {
  if (!TOKEN) return false;
  const result = await apiRequest('/users/@me');
  if (result.status === 200) {
    botUser = result.data;
    return true;
  }
  return false;
}

// Slow check - one at a time with delay
async function slowCheck(username) {
  const result = await apiRequest(`/users/${username}`);
  checkCount++;
  return {
    username,
    available: result.status === 404,
    taken: result.status === 200,
    error: result.status !== 404 && result.status !== 200
  };
}

// Generate random username
function generateUsername(type) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const length = type === '3' ? 3 : type === '4' ? 4 : type === '5' ? 5 : Math.floor(Math.random() * 3) + 3;
  let name = '';
  for (let i = 0; i < length; i++) {
    name += chars[Math.floor(Math.random() * chars.length)];
  }
  return name;
}

app.get('/', async (req, res) => {
  const valid = await validateToken();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Discord Checker</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          background: #0a0a0a; 
          color: #fff; 
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 20px;
        }
        .card { 
          background: #111; 
          padding: 30px; 
          border-radius: 16px; 
          border: 1px solid #222;
          width: 100%;
          max-width: 400px;
          text-align: center;
          margin-bottom: 20px;
        }
        .status { 
          width: 60px; 
          height: 60px; 
          border-radius: 50%; 
          margin: 0 auto 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        }
        .online { background: #3ba55d; }
        .offline { background: #ed4245; }
        h1 { font-size: 22px; margin-bottom: 8px; }
        .subtitle { color: #666; font-size: 14px; margin-bottom: 20px; }
        .user-tag {
          background: #1a1a1a;
          padding: 12px 20px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
        }
        .dot { width: 10px; height: 10px; background: #3ba55d; border-radius: 50%; }
        button {
          width: 100%;
          padding: 16px;
          border-radius: 12px;
          border: none;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-main { background: #5865f2; color: #fff; }
        .btn-main:hover { background: #4752c4; }
        .btn-stop { background: #ed4245; color: #fff; }
        .btn-stop:hover { background: #c03537; }
        .stats {
          display: flex;
          justify-content: space-around;
          padding: 20px;
          background: #111;
          border-radius: 12px;
          width: 100%;
          max-width: 400px;
        }
        .stat { text-align: center; }
        .stat-num { font-size: 24px; font-weight: 700; color: #5865f2; }
        .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="status ${valid ? 'online' : 'offline'}">${valid ? '✓' : '✕'}</div>
        <h1>${valid ? 'Ready' : 'No Token'}</h1>
        <div class="subtitle">${valid ? 'Discord API Connected' : 'Add DISCORD_TOKEN variable'}</div>
        
        ${valid ? `
        <div class="user-tag">
          <div class="dot"></div>
          <span>@${botUser.username}</span>
        </div>
        <button class="btn-main" onclick="location.href='/check'">Start Checking</button>
        ` : `
        <button disabled style="background: #333; color: #666;">Configure Token First</button>
        `}
      </div>
      
      ${valid ? `
      <div class="stats">
        <div class="stat">
          <div class="stat-num" id="count">0</div>
          <div class="stat-label">Checked</div>
        </div>
        <div class="stat">
          <div class="stat-num" id="found">0</div>
          <div class="stat-label">Available</div>
        </div>
      </div>
      ` : ''}
    </body>
    </html>
  `);
});

// Main checker page
app.get('/check', (req, res) => {
  if (!TOKEN) return res.redirect('/');
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Infinite Checker</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          background: #000; 
          color: #fff; 
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          min-height: 100vh;
        }
        
        .top {
          position: sticky;
          top: 0;
          background: rgba(0,0,0,0.95);
          backdrop-filter: blur(10px);
          padding: 15px 20px;
          border-bottom: 1px solid #222;
          z-index: 100;
        }
        .top h1 { font-size: 18px; margin-bottom: 10px; }
        
        .controls {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        
        select {
          background: #1a1a1a;
          color: #fff;
          border: 1px solid #333;
          padding: 10px 15px;
          border-radius: 8px;
          font-size: 14px;
        }
        
        button {
          padding: 10px 20px;
          border-radius: 8px;
          border: none;
          font-weight: 600;
          cursor: pointer;
          font-size: 14px;
        }
        .start { background: #3ba55d; color: #fff; }
        .start:disabled { background: #333; color: #666; }
        .stop { background: #ed4245; color: #fff; }
        
        .info-bar {
          display: flex;
          justify-content: space-between;
          padding: 15px 20px;
          background: #111;
          border-bottom: 1px solid #222;
          font-size: 14px;
        }
        .info-bar span { color: #888; }
        .info-bar b { color: #fff; margin-left: 5px; }
        
        .columns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          padding: 15px;
        }
        
        @media (max-width: 600px) {
          .columns { grid-template-columns: 1fr; }
        }
        
        .col {
          background: #111;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid #222;
        }
        .col-header {
          padding: 15px;
          font-size: 14px;
          font-weight: 700;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .avail-head { background: rgba(59,165,93,0.1); color: #3ba55d; }
        .log-head { background: rgba(88,101,242,0.1); color: #5865f2; }
        .badge {
          background: rgba(255,255,255,0.1);
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 12px;
        }
        
        .list {
          max-height: 60vh;
          overflow-y: auto;
          padding: 10px;
        }
        
        .item {
          padding: 12px;
          background: #1a1a1a;
          border-radius: 8px;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-family: monospace;
          font-size: 15px;
          animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .item.avail { border-left: 3px solid #3ba55d; }
        .item.taken { border-left: 3px solid #ed4245; opacity: 0.6; }
        .item.checking { border-left: 3px solid #5865f2; }
        
        .status-icon { font-size: 12px; }
        .time { font-size: 11px; color: #666; }
        
        .copy-btn {
          background: #333;
          border: none;
          color: #fff;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        }
        .copy-btn:active { background: #444; }
        
        .empty {
          text-align: center;
          padding: 40px;
          color: #555;
          font-size: 14px;
        }
        
        .running {
          display: inline-block;
          width: 8px;
          height: 8px;
          background: #3ba55d;
          border-radius: 50%;
          margin-right: 8px;
          animation: pulse 1s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      </style>
    </head>
    <body>
      <div class="top">
        <h1>🔍 Infinite Username Checker</h1>
        <div class="controls">
          <select id="type">
            <option value="3">3 chars</option>
            <option value="4" selected>4 chars</option>
            <option value="5">5 chars</option>
            <option value="any">Random 3-5</option>
          </select>
          <button class="start" id="startBtn" onclick="start()">Start</button>
          <button class="stop" id="stopBtn" onclick="stop()" disabled>Stop</button>
        </div>
      </div>
      
      <div class="info-bar">
        <div>Status: <b id="status">Idle</b></div>
        <div>Checked: <b id="checked">0</b></div>
        <div>Found: <b id="found">0</b></div>
        <div>Speed: <b id="speed">-</b></div>
      </div>
      
      <div class="columns">
        <div class="col">
          <div class="col-header avail-head">
            ✅ Available
            <span class="badge" id="avail-badge">0</span>
          </div>
          <div class="list" id="avail-list">
            <div class="empty">Start checking to find available usernames</div>
          </div>
        </div>
        
        <div class="col">
          <div class="col-header log-head">
            📝 Activity Log
            <span class="badge" id="log-badge">0</span>
          </div>
          <div class="list" id="log-list">
            <div class="empty">Check activity appears here</div>
          </div>
        </div>
      </div>

      <script>
        let running = false;
        let checked = 0;
        let found = 0;
        let startTime = null;
        
        async function start() {
          if (running) return;
          running = true;
          
          document.getElementById('startBtn').disabled = true;
          document.getElementById('stopBtn').disabled = false;
          document.getElementById('status').innerHTML = '<span class="running"></span>Running';
          startTime = Date.now();
          
          // Clear lists if starting fresh
          if (checked === 0) {
            document.getElementById('avail-list').innerHTML = '';
            document.getElementById('log-list').innerHTML = '';
          }
          
          const type = document.getElementById('type').value;
          
          while (running) {
            const username = generate(type);
            
            // Add checking indicator to log
            const logId = addLog(username, 'checking');
            
            try {
              const res = await fetch('/api/check/' + username);
              const data = await res.json();
              
              checked++;
              updateStats();
              
              // Update log
              updateLog(logId, data);
              
              // If available, add to found list
              if (data.available) {
                found++;
                addAvailable(username);
                document.getElementById('found').textContent = found;
                document.getElementById('avail-badge').textContent = found;
              }
              
            } catch (e) {
              updateLog(logId, { error: true, username });
            }
            
            // Random delay between 3-8 seconds (slow and safe)
            const delay = 3000 + Math.random() * 5000;
            await sleep(delay);
          }
          
          document.getElementById('status').textContent = 'Stopped';
          document.getElementById('startBtn').disabled = false;
          document.getElementById('stopBtn').disabled = true;
        }
        
        function stop() {
          running = false;
        }
        
        function generate(type) {
          const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
          const len = type === 'any' ? 3 + Math.floor(Math.random() * 3) : parseInt(type);
          let name = '';
          for (let i = 0; i < len; i++) {
            name += chars[Math.floor(Math.random() * chars.length)];
          }
          return name;
        }
        
        function sleep(ms) {
          return new Promise(r => setTimeout(r, ms));
        }
        
        function addLog(username, status) {
          const id = 'log-' + Date.now();
          const div = document.createElement('div');
          div.id = id;
          div.className = 'item checking';
          div.innerHTML = \`
            <div>
              <div>\${username}</div>
              <div class="time">\${new Date().toLocaleTimeString()}</div>
            </div>
            <span class="status-icon">⏳</span>
          \`;
          
          const list = document.getElementById('log-list');
          list.prepend(div);
          
          // Keep only last 50 in log
          while (list.children.length > 50) {
            list.removeChild(list.lastChild);
          }
          
          document.getElementById('log-badge').textContent = checked;
          return id;
        }
        
        function updateLog(id, data) {
          const div = document.getElementById(id);
          if (!div) return;
          
          if (data.error) {
            div.className = 'item';
            div.innerHTML = \`
              <div>
                <div>\${data.username}</div>
                <div class="time">Error</div>
              </div>
              <span style="color:#faa61a">⚠️</span>
            \`;
          } else if (data.available) {
            div.className = 'item avail';
            div.innerHTML = \`
              <div>
                <div>\${data.username}</div>
                <div class="time" style="color:#3ba55d">Available!</div>
              </div>
              <span style="color:#3ba55d">✓</span>
            \`;
          } else {
            div.className = 'item taken';
            div.innerHTML = \`
              <div>
                <div style="opacity:0.6">\${data.username}</div>
                <div class="time">Taken</div>
              </div>
              <span style="color:#ed4245">✕</span>
            \`;
          }
        }
        
        function addAvailable(username) {
          const list = document.getElementById('avail-list');
          
          // Remove empty msg
          if (list.children[0]?.className === 'empty') {
            list.innerHTML = '';
          }
          
          const div = document.createElement('div');
          div.className = 'item avail';
          div.style.background = 'rgba(59,165,93,0.1)';
          div.innerHTML = \`
            <span>\${username}</span>
            <button class="copy-btn" onclick="copy('\${username}')">Copy</button>
          \`;
          list.prepend(div);
        }
        
        function updateStats() {
          document.getElementById('checked').textContent = checked;
          
          // Calculate speed
          if (startTime) {
            const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes
            const speed = elapsed > 0 ? (checked / elapsed).toFixed(1) : 0;
            document.getElementById('speed').textContent = speed + '/min';
          }
        }
        
        function copy(text) {
          navigator.clipboard.writeText(text);
          event.target.textContent = 'Copied!';
          setTimeout(() => event.target.textContent = 'Copy', 1500);
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/api/check/:username', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const result = await slowCheck(req.params.username.toLowerCase());
  res.json(result);
});

app.get('/api/stats', (req, res) => {
  res.json({
    checked: checkCount,
    found: foundUsernames.length,
    recent: foundUsernames.slice(-10),
    running: checking
  });
});

validateToken().then(() => {
  app.listen(PORT, () => console.log(`Port ${PORT}`));
});
