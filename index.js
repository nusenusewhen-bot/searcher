const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

app.use(express.json());
app.use(express.static('public'));

let botUser = null;

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
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, error: true }); });
    req.end();
  });
}

async function validateToken() {
  if (!TOKEN) return false;
  const result = await apiRequest('/users/@me');
  if (result.status === 200) {
    botUser = result.data;
    console.log(`Logged in as @${botUser.username}`);
    return true;
  }
  return false;
}

// Concurrent batch check - 20 at a time
async function batchCheck(usernames, concurrency = 20) {
  const results = { available: [], taken: [], errors: [] };
  const queue = [...usernames];
  
  async function worker() {
    while (queue.length > 0) {
      const user = queue.shift();
      try {
        const result = await apiRequest(`/users/${user}`);
        if (result.status === 404) results.available.push(user);
        else if (result.status === 200) results.taken.push(user);
        else results.errors.push(user);
      } catch (e) {
        results.errors.push(user);
      }
    }
  }

  const workers = Array(concurrency).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

app.get('/', async (req, res) => {
  const valid = await validateToken();
  
  if (!valid) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Discord Checker</title>
        <style>
          body { background: #0d0d0d; color: #fff; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .box { background: #1a1a1a; padding: 40px; border-radius: 12px; text-align: center; border: 1px solid #333; }
          h1 { color: #ed4245; }
          a { color: #5865f2; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>⚠️ No Token</h1>
          <p>Add DISCORD_TOKEN to Railway variables</p>
          <p><a href="/searcher.html">Continue anyway →</a></p>
        </div>
      </body>
      </html>
    `);
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Discord Checker - @${botUser.username}</title>
      <style>
        body { background: #0d0d0d; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .box { background: #1a1a1a; padding: 50px; border-radius: 16px; text-align: center; border: 1px solid #333; min-width: 400px; }
        h1 { color: #3ba55d; margin-bottom: 10px; }
        .user { display: flex; align-items: center; justify-content: center; gap: 15px; margin: 30px 0; }
        .avatar { width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, #5865f2, #4752c4); display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; }
        .info { text-align: left; }
        .name { font-size: 24px; font-weight: 700; }
        .id { color: #888; font-size: 13px; margin-top: 4px; }
        button { background: #5865f2; color: #fff; border: none; padding: 16px 50px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600; margin-top: 10px; }
        button:hover { background: #4752c4; transform: translateY(-2px); transition: all 0.2s; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>✅ Connected</h1>
        <div class="user">
          <div class="avatar">${botUser.username.charAt(0).toUpperCase()}</div>
          <div class="info">
            <div class="name">@${botUser.username}</div>
            <div class="id">${botUser.id}</div>
          </div>
        </div>
        <button onclick="location.href='/searcher.html'">Launch Checker</button>
      </div>
    </body>
    </html>
  `);
});

app.get('/api/check/:username', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  const result = await apiRequest(`/users/${req.params.username.toLowerCase()}`);
  res.json({
    username: req.params.username,
    available: result.status === 404,
    status: result.status
  });
});

// Mass check endpoint - 100+ at once
app.post('/api/mass-check', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const { usernames, concurrency = 20 } = req.body;
  if (!Array.isArray(usernames)) return res.status(400).json({ error: 'Array required' });
  
  const startTime = Date.now();
  const results = await batchCheck(usernames.slice(0, 100), concurrency);
  
  res.json({
    ...results,
    total_checked: usernames.length,
    available_count: results.available.length,
    taken_count: results.taken.length,
    time_ms: Date.now() - startTime,
    checked_by: botUser?.username
  });
});

app.get('/api/gen/:type/:count', (req, res) => {
  const type = req.params.type; // '3', '4', '5', 'any'
  const count = Math.min(parseInt(req.params.count) || 50, 100);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  
  const names = [];
  for (let i = 0; i < count; i++) {
    const len = type === 'any' ? Math.floor(Math.random() * 3) + 3 : parseInt(type);
    let name = '';
    for (let j = 0; j < len; j++) name += chars[Math.floor(Math.random() * chars.length)];
    names.push(name);
  }
  res.json({ usernames: names, type, count });
});

app.listen(PORT, () => {
  validateToken();
  console.log(`Running on ${PORT}`);
});
