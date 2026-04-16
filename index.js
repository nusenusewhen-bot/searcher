const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

app.use(express.json());
app.use(express.static('public'));

// Store user info after validation
let botUser = null;

function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10${path}`,
      method: method,
      headers: {
        'Authorization': TOKEN,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0.36',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
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

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Validate token on startup and get user info
async function validateToken() {
  if (!TOKEN) {
    console.log('⚠️ No DISCORD_TOKEN provided');
    return false;
  }
  try {
    const result = await apiRequest('/users/@me');
    if (result.status === 200) {
      botUser = result.data;
      console.log(`✅ Logged in as @${botUser.username}`);
      return true;
    } else {
      console.log('❌ Invalid token');
      return false;
    }
  } catch (e) {
    console.log('❌ Token validation failed:', e.message);
    return false;
  }
}

// Root route - serves login status
app.get('/', async (req, res) => {
  const isValid = await validateToken();
  
  if (!isValid) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Discord Checker - Not Logged In</title>
        <style>
          body { background: #0d0d0d; color: #fff; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .box { background: #1a1a1a; padding: 40px; border-radius: 12px; text-align: center; border: 1px solid #333; }
          h1 { color: #ed4245; margin-bottom: 20px; }
          p { color: #888; }
          a { color: #5865f2; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>⚠️ Not Logged In</h1>
          <p>Set DISCORD_TOKEN in Railway variables</p>
          <p><a href="/searcher.html">Try anyway →</a></p>
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
        body { background: #0d0d0d; color: #fff; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .box { background: #1a1a1a; padding: 40px; border-radius: 12px; text-align: center; border: 1px solid #333; }
        h1 { color: #3ba55d; margin-bottom: 20px; }
        .user { display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 30px; }
        .avatar { width: 64px; height: 64px; border-radius: 50%; background: #5865f2; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; }
        .info { text-align: left; }
        .username { font-size: 24px; font-weight: 600; color: #fff; }
        .id { color: #888; font-size: 14px; }
        button { background: #5865f2; color: #fff; border: none; padding: 15px 40px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600; }
        button:hover { background: #4752c4; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>✅ Connected</h1>
        <div class="user">
          <div class="avatar">${botUser.username.charAt(0).toUpperCase()}</div>
          <div class="info">
            <div class="username">@${botUser.username}</div>
            <div class="id">ID: ${botUser.id}</div>
          </div>
        </div>
        <button onclick="location.href='/searcher.html'">Open Checker</button>
      </div>
    </body>
    </html>
  `);
});

// Check username availability
app.get('/api/check/:username', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token configured' });
  
  const username = req.params.username.toLowerCase().replace(/[^a-z0-9_.]/g, '');
  
  try {
    // Try to get user by username - 200 = exists, 404 = available
    const result = await apiRequest(`/users/${username}`);
    
    res.json({
      username: username,
      available: result.status === 404,
      taken: result.status === 200,
      status: result.status
    });
  } catch (e) {
    res.json({ username: username, available: false, error: e.message });
  }
});

// Generate usernames
app.get('/api/gen/:len/:count', (req, res) => {
  const len = Math.min(parseInt(req.params.len) || 4, 32);
  const count = Math.min(parseInt(req.params.count) || 20, 100);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  
  const names = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    for (let j = 0; j < len; j++) name += chars[Math.floor(Math.random() * chars.length)];
    names.push(name);
  }
  res.json({ usernames: names, length: len, count });
});

// Batch check
app.post('/api/batch', async (req, res) => {
  const { usernames } = req.body;
  if (!Array.isArray(usernames)) return res.status(400).json({ error: 'Send array' });
  
  const results = [];
  for (const user of usernames.slice(0, 30)) {
    try {
      const result = await apiRequest(`/users/${user}`);
      results.push({
        username: user,
        available: result.status === 404,
        status: result.status
      });
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      results.push({ username: user, error: e.message });
    }
  }
  res.json({ results, checked_as: botUser?.username });
});

// Health check
app.get('/health', (req, res) => res.json({ 
  status: botUser ? 'logged_in' : 'no_token',
  user: botUser ? { username: botUser.username, id: botUser.id } : null
}));

validateToken().then(() => {
  app.listen(PORT, () => console.log(`Live on port ${PORT}`));
});
