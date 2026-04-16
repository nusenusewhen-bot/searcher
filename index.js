const express = require('express');
const { request } = require('undici');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;
const PROXY_URL = process.env.PROXY_URL; // Optional: http://user:pass@host:port

app.use(express.json());
app.use(express.static('public'));

let botUser = null;

const dispatcher = PROXY_URL 
  ? new HttpsProxyAgent(PROXY_URL)
  : undefined;

async function apiRequest(path) {
  try {
    const { statusCode, body } = await request(`https://discord.com/api/v10${path}`, {
      headers: {
        'Authorization': TOKEN,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
        'X-Super-Properties': Buffer.from(JSON.stringify({
          os: 'iOS',
          browser: 'Mobile Safari',
          device: 'iPhone'
        })).toString('base64')
      },
      dispatcher
    });
    
    const data = await body.json().catch(() => null);
    return { status: statusCode, data };
  } catch (e) {
    return { status: 0, error: e.message };
  }
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

async function batchCheck(usernames, concurrency = 10) {
  const results = { available: [], taken: [], errors: [], rateLimited: false };
  const queue = [...usernames];
  
  async function worker() {
    while (queue.length > 0) {
      const user = queue.shift();
      const result = await apiRequest(`/users/${user}`);
      
      if (result.status === 429) {
        results.rateLimited = true;
        results.errors.push(user);
      } else if (result.status === 404) {
        results.available.push(user);
      } else if (result.status === 200) {
        results.taken.push(user);
      } else {
        results.errors.push(user);
      }
      
      // Small delay to avoid aggressive rate limiting
      await new Promise(r => setTimeout(r, 100));
    }
  }

  await Promise.all(Array(concurrency).fill(null).map(worker));
  return results;
}

app.get('/', async (req, res) => {
  const valid = await validateToken();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>Discord Checker</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          background: #0a0a0a; 
          color: #fff; 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .box { 
          background: #111; 
          padding: 30px; 
          border-radius: 16px; 
          text-align: center; 
          border: 1px solid #222;
          width: 100%;
          max-width: 400px;
        }
        .status { 
          width: 60px; 
          height: 60px; 
          border-radius: 50%; 
          margin: 0 auto 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
        }
        .online { background: #3ba55d; }
        .offline { background: #ed4245; }
        h1 { font-size: 24px; margin-bottom: 10px; }
        p { color: #888; margin-bottom: 25px; font-size: 14px; }
        .user-info {
          background: #1a1a1a;
          padding: 15px;
          border-radius: 12px;
          margin-bottom: 25px;
          display: flex;
          align-items: center;
          gap: 15px;
          text-align: left;
        }
        .avatar { 
          width: 50px; 
          height: 50px; 
          border-radius: 50%; 
          background: #5865f2;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: bold;
        }
        .info { flex: 1; }
        .username { font-weight: 600; font-size: 18px; }
        .userid { color: #666; font-size: 12px; margin-top: 4px; }
        button {
          width: 100%;
          background: ${valid ? '#5865f2' : '#333'};
          color: #fff;
          border: none;
          padding: 16px;
          border-radius: 12px;
          cursor: ${valid ? 'pointer' : 'not-allowed'};
          font-weight: 600;
          font-size: 16px;
        }
        button:active { transform: scale(0.98); }
        .proxy-status {
          margin-top: 15px;
          padding: 10px;
          border-radius: 8px;
          font-size: 12px;
          color: ${PROXY_URL ? '#3ba55d' : '#faa61a'};
          background: ${PROXY_URL ? 'rgba(59,165,93,0.1)' : 'rgba(250,166,26,0.1)'};
        }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="status ${valid ? 'online' : 'offline'}">
          ${valid ? '✓' : '✕'}
        </div>
        <h1>${valid ? 'Connected' : 'Not Connected'}</h1>
        <p>${valid ? 'Ready to check usernames' : 'Add DISCORD_TOKEN to Railway variables'}</p>
        
        ${valid ? `
        <div class="user-info">
          <div class="avatar">${botUser.username.charAt(0).toUpperCase()}</div>
          <div class="info">
            <div class="username">@${botUser.username}</div>
            <div class="userid">${botUser.id}</div>
          </div>
        </div>
        ` : ''}
        
        <button onclick="${valid ? "location.href='/app'" : 'alert(\'Configure token first\')'}" ${!valid ? 'disabled' : ''}>
          ${valid ? 'Open Checker' : 'Configure Token'}
        </button>
        
        <div class="proxy-status">
          ${PROXY_URL ? '🟢 Proxy Enabled' : '🟡 No Proxy - May be blocked by Discord'}
        </div>
      </div>
    </body>
    </html>
  `);
});

// Mobile app interface
app.get('/app', (req, res) => {
  if (!TOKEN) return res.redirect('/');
  res.sendFile(__dirname + '/public/app.html');
});

app.get('/api/check/:username', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  const result = await apiRequest(`/users/${req.params.username.toLowerCase()}`);
  res.json({
    username: req.params.username,
    available: result.status === 404,
    status: result.status,
    rateLimited: result.status === 429
  });
});

app.post('/api/mass-check', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const { usernames, concurrency = 8 } = req.body;
  if (!Array.isArray(usernames)) return res.status(400).json({ error: 'Array required' });
  
  const startTime = Date.now();
  const results = await batchCheck(usernames.slice(0, 50), concurrency);
  
  res.json({
    ...results,
    total: usernames.length,
    time_ms: Date.now() - startTime,
    used_proxy: !!PROXY_URL
  });
});

app.get('/api/gen/:type/:count', (req, res) => {
  const type = req.params.type;
  const count = Math.min(parseInt(req.params.count) || 30, 50);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  
  const names = [];
  for (let i = 0; i < count; i++) {
    const len = type === 'any' ? Math.floor(Math.random() * 3) + 3 : parseInt(type);
    let name = '';
    for (let j = 0; j < len; j++) name += chars[Math.floor(Math.random() * chars.length)];
    names.push(name);
  }
  res.json({ usernames: names });
});

validateToken().then(() => {
  app.listen(PORT, () => console.log(`Port ${PORT}`));
});
