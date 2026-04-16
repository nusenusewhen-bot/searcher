const express = require('express');
const https = require('https');
const http = require('http');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

// Built-in proxy sources - mix of free and premium endpoints
const PROXY_SOURCES = [
  'http://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt'
];

let botUser = null;
let currentProxy = 0;
let workingProxies = [];
let failedProxies = new Set();
let proxyStats = { total: 0, working: 0, failed: 0 };

// Scrape proxies from multiple sources
async function scrapeProxies() {
  const allProxies = new Set();
  
  // Add environment proxies first (premium/residential)
  const envProxies = (process.env.PROXY_LIST || '').split(',').filter(p => p.trim());
  envProxies.forEach(p => allProxies.add(p.trim()));

  // Scrape free lists
  for (const source of PROXY_SOURCES) {
    try {
      const proxies = await fetchProxyList(source);
      proxies.forEach(p => allProxies.add(p));
    } catch (e) {
      console.log(`Failed to scrape ${source}: ${e.message}`);
    }
  }

  const uniqueProxies = Array.from(allProxies).filter(p => p.includes(':'));
  console.log(`Scraped ${uniqueProxies.length} unique proxies`);
  return uniqueProxies;
}

function fetchProxyList(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const proxies = data.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'))
          .map(line => {
            // Convert ip:port format to http://ip:port
            if (!line.startsWith('http')) return `http://${line}`;
            return line;
          });
        resolve(proxies);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Fast proxy validation
async function validateProxy(proxyUrl) {
  return new Promise((resolve) => {
    const agent = new HttpsProxyAgent(proxyUrl);
    const start = Date.now();
    
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: '/api/v10/gateway',
      method: 'GET',
      agent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    };

    const req = https.request(options, (res) => {
      const latency = Date.now() - start;
      resolve({ 
        proxy: proxyUrl, 
        working: res.statusCode === 200, 
        latency: latency 
      });
    });

    req.on('error', () => resolve({ proxy: proxyUrl, working: false, latency: 99999 }));
    req.on('timeout', () => { 
      req.destroy(); 
      resolve({ proxy: proxyUrl, working: false, latency: 99999 }); 
    });
    req.end();
  });
}

// Test all proxies and keep only working ones
async function initProxies() {
  const scraped = await scrapeProxies();
  proxyStats.total = scraped.length;
  
  console.log(`Testing ${scraped.length} proxies...`);
  
  // Test in batches of 50 for speed
  const batchSize = 50;
  workingProxies = [];
  
  for (let i = 0; i < scraped.length; i += batchSize) {
    const batch = scraped.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(p => validateProxy(p)));
    
    const batchWorking = results.filter(r => r.working).map(r => r.proxy);
    workingProxies.push(...batchWorking);
    
    console.log(`Batch ${i/batchSize + 1}: ${batchWorking.length}/${batch.length} working`);
  }

  // Sort by reliability (environment proxies first, then by speed)
  const envSet = new Set((process.env.PROXY_LIST || '').split(',').map(p => p.trim()));
  workingProxies.sort((a, b) => {
    const aIsPremium = envSet.has(a);
    const bIsPremium = envSet.has(b);
    if (aIsPremium && !bIsPremium) return -1;
    if (!aIsPremium && bIsPremium) return 1;
    return 0;
  });

  proxyStats.working = workingProxies.length;
  proxyStats.failed = proxyStats.total - proxyStats.working;
  
  console.log(`Proxy pool ready: ${workingProxies.length}/${scraped.length} working`);
  return workingProxies;
}

function getNextProxy() {
  if (workingProxies.length === 0) return null;
  
  // Skip recently failed proxies
  let attempts = 0;
  let proxy;
  
  do {
    proxy = workingProxies[currentProxy];
    currentProxy = (currentProxy + 1) % workingProxies.length;
    attempts++;
  } while (failedProxies.has(proxy) && attempts < workingProxies.length);
  
  // Reset failed list if all marked bad
  if (attempts >= workingProxies.length) {
    failedProxies.clear();
    console.log('Reset failed proxy cache, retrying all');
  }
  
  return proxy;
}

function apiRequest(path, retryCount = 0) {
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-RateLimit-Precision': 'millisecond'
      },
      agent: agent,
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Mark proxy failed on rate limit or cloudflare block
        if ((res.statusCode === 429 || res.statusCode === 403 || res.statusCode === 1020) && proxy) {
          failedProxies.add(proxy);
          proxyStats.failed++;
        }

        // Auto-retry with new proxy on rate limit
        if (res.statusCode === 429 && retryCount < 3 && workingProxies.length > 1) {
          const retryAfter = Math.min(JSON.parse(data).retry_after || 1, 5);
          setTimeout(() => {
            resolve(apiRequest(path, retryCount + 1));
          }, retryAfter * 1000);
          return;
        }
        
        try { 
          resolve({ 
            status: res.statusCode, 
            data: JSON.parse(data), 
            proxy: proxy,
            headers: res.headers
          }); 
        } catch { 
          resolve({ status: res.statusCode, data, proxy: proxy }); 
        }
      });
    });

    req.on('error', (err) => {
      if (proxy) failedProxies.add(proxy);
      
      // Retry on connection error
      if (retryCount < 2 && workingProxies.length > 1) {
        setTimeout(() => resolve(apiRequest(path, retryCount + 1)), 500);
      } else {
        resolve({ status: 0, error: err.message, proxy: proxy });
      }
    });
    
    req.setTimeout(15000, () => {
      req.destroy();
      if (proxy) failedProxies.add(proxy);
      resolve({ status: 0, timeout: true, proxy: proxy });
    });
    
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

// Routes
app.get('/', async (req, res) => {
  const valid = await validateToken();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Proxy Checker - ${workingProxies.length} Proxies</title>
      <style>
        body { background: #0a0a0a; color: #fff; font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
        .card { background: #111; padding: 25px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #222; }
        h1 { font-size: 24px; margin-bottom: 15px; }
        .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 15px 0; }
        .stat { background: #0d0d0d; padding: 15px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 28px; font-weight: bold; color: #5865f2; }
        .stat-label { font-size: 12px; color: #666; margin-top: 5px; }
        .status { display: inline-block; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 15px; }
        .ok { background: #3ba55d; }
        .bad { background: #ed4245; }
        button { width: 100%; padding: 15px; background: #5865f2; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 10px; }
        button:disabled { background: #333; color: #666; }
        .refresh { background: #3ba55d; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🔌 Proxy Rotator</h1>
        <span class="status ${valid ? 'ok' : 'bad'}">${valid ? 'Connected' : 'No Token'}</span>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-value">${proxyStats.total}</div>
            <div class="stat-label">Scraped</div>
          </div>
          <div class="stat">
            <div class="stat-value" style="color:#3ba55d">${proxyStats.working}</div>
            <div class="stat-label">Working</div>
          </div>
          <div class="stat">
            <div class="stat-value" style="color:#ed4245">${proxyStats.failed}</div>
            <div class="stat-label">Failed</div>
          </div>
        </div>

        ${valid ? `
        <button onclick="location.href='/app'">Start Checker</button>
        <button class="refresh" onclick="fetch('/api/refresh-proxies').then(()=>location.reload())" style="margin-top:10px;background:#3ba55d;">Refresh Proxies</button>
        ` : `<button disabled>Configure DISCORD_TOKEN</button>`}
      </div>
    </body>
    </html>
  `);
});

app.get('/api/refresh-proxies', async (req, res) => {
  await initProxies();
  res.json({ success: true, working: workingProxies.length, stats: proxyStats });
});

app.get('/api/check/:username', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  if (workingProxies.length === 0) return res.status(503).json({ error: 'No working proxies' });
  
  const result = await apiRequest(`/users/${req.params.username.toLowerCase()}`);
  
  res.json({
    username: req.params.username,
    available: result.status === 404,
    taken: result.status === 200,
    status: result.status,
    proxy_used: result.proxy ? result.proxy.replace(/\/\/.*@/, '//***@') : 'none',
    rate_limited: result.status === 429
  });
});

app.post('/api/mass-check', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const { usernames, concurrent = 5, delay = 100 } = req.body;
  const results = { available: [], taken: [], rateLimited: [], errors: [] };
  const startTime = Date.now();

  // Process with concurrency limit
  const queue = [...usernames.slice(0, 100)];
  const active = new Set();

  async function processOne(user) {
    const result = await apiRequest(`/users/${user}`);
    
    if (result.status === 404) results.available.push(user);
    else if (result.status === 200) results.taken.push(user);
    else if (result.status === 429) results.rateLimited.push({ user, retryAfter: result.data?.retry_after });
    else results.errors.push({ user, status: result.status });
    
    await new Promise(r => setTimeout(r, delay));
  }

  while (queue.length > 0 || active.size > 0) {
    while (active.size < concurrent && queue.length > 0) {
      const user = queue.shift();
      const promise = processOne(user).finally(() => active.delete(promise));
      active.add(promise);
    }
    
    if (active.size > 0) {
      await Promise.race(active);
    }
  }

  res.json({
    ...results,
    total: usernames.length,
    duration: Date.now() - startTime,
    proxies_remaining: workingProxies.length - failedProxies.size,
    requests_per_second: (usernames.length / ((Date.now() - startTime) / 1000)).toFixed(2)
  });
});

app.get('/api/gen/:type/:count', (req, res) => {
  const type = req.params.type;
  const count = Math.min(parseInt(req.params.count) || 30, 200);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  
  const names = [];
  for (let i = 0; i < count; i++) {
    const len = type === 'any' ? 2 + Math.floor(Math.random() * 4) : parseInt(type);
    let name = '';
    for (let j = 0; j < len; j++) name += chars[Math.floor(Math.random() * chars.length)];
    names.push(name);
  }
  res.json({ usernames: names, count: names.length });
});

// Auto-refresh proxies every 10 minutes
setInterval(async () => {
  console.log('Auto-refreshing proxy pool...');
  await initProxies();
}, 600000);

// Start server
(async () => {
  await initProxies();
  const valid = await validateToken();
  
  app.listen(PORT, () => {
    console.log(`🚀 Server ready on port ${PORT}`);
    console.log(`📊 Proxies: ${workingProxies.length} working | Token: ${valid ? '✅ Valid' : '❌ Missing'}`);
  });
})();
