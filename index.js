const express = require('express');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;
const PROXY_LIST = (process.env.PROXY_LIST || '').split(',').filter(p => p.trim());

app.use(express.json());
app.use(express.static('public'));

let botUser = null;
let currentProxy = 0;
let workingProxies = [];
let failedProxies = new Set();

function getNextProxy() {
  if (PROXY_LIST.length === 0) return null;
  const proxy = PROXY_LIST[currentProxy];
  currentProxy = (currentProxy + 1) % PROXY_LIST.length;
  return proxy.trim();
}

function apiRequest(path) {
  return new Promise((resolve) => {
    const proxy = getNextProxy();
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10${path}`,
      method: 'GET',
      headers: {
        'Authorization': TOKEN,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      agent: agent
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data), proxy: proxy }); } 
        catch { resolve({ status: res.statusCode, data, proxy: proxy }); }
      });
    });

    req.on('error', () => resolve({ status: 0, error: true, proxy: proxy }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, timeout: true, proxy: proxy }); });
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

app.get('/', async (req, res) => {
  const valid = await validateToken();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Proxy Checker</title>
      <style>
        body { background: #0a0a0a; color: #fff; font-family: sans-serif; padding: 20px; max-width: 500px; margin: 0 auto; }
        .card { background: #111; padding: 25px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #222; }
        h1 { font-size: 20px; margin-bottom: 15px; }
        .status { display: inline-block; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 15px; }
        .ok { background: #3ba55d; }
        .bad { background: #ed4245; }
        .proxy-list { background: #0d0d0d; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 12px; color: #888; margin: 15px 0; }
        .proxy-list span { color: #3ba55d; margin-right: 10px; }
        button { width: 100%; padding: 15px; background: #5865f2; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; }
        button:disabled { background: #333; color: #666; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🔌 Proxy Rotator</h1>
        <span class="status ${valid ? 'ok' : 'bad'}">${valid ? 'Connected' : 'No Token'}</span>
        <div>Proxies loaded: <b style="color:#5865f2">${PROXY_LIST.length}</b></div>
        ${PROXY_LIST.length > 0 ? `
        <div class="proxy-list">
          ${PROXY_LIST.map((p, i) => `<span>${i+1}.</span>${p.replace(/\/\/.*@/, '//***@')}`).join('<br>')}
        </div>
        ` : '<p style="color:#666;font-size:14px;">Add PROXY_LIST to Railway variables<br>Format: http://user:pass@ip:port,http://user:pass@ip:port</p>'}
        ${valid ? `<button onclick="location.href='/app'">Start Checker</button>` : `<button disabled>Configure Token</button>`}
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
    taken: result.status === 200,
    status: result.status,
    proxy_used: result.proxy ? 'yes' : 'no',
    proxy_index: currentProxy
  });
});

app.post('/api/mass-check', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const { usernames } = req.body;
  const results = { available: [], taken: [], errors: [] };
  
  for (const user of usernames.slice(0, 50)) {
    const result = await apiRequest(`/users/${user}`);
    
    if (result.status === 404) results.available.push(user);
    else if (result.status === 200) results.taken.push(user);
    else results.errors.push({ user, status: result.status });
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  res.json({
    ...results,
    total: usernames.length,
    proxies_available: PROXY_LIST.length
  });
});

app.get('/api/gen/:type/:count', (req, res) => {
  const type = req.params.type;
  const count = Math.min(parseInt(req.params.count) || 30, 100);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  
  const names = [];
  for (let i = 0; i < count; i++) {
    const len = type === 'any' ? 3 + Math.floor(Math.random() * 3) : parseInt(type);
    let name = '';
    for (let j = 0; j < len; j++) name += chars[Math.floor(Math.random() * chars.length)];
    names.push(name);
  }
  res.json({ usernames: names });
});

validateToken().then(() => {
  app.listen(PORT, () => console.log(`Port ${PORT} | Proxies: ${PROXY_LIST.length}`));
});
