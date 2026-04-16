const express = require('express');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');

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

// Proxy validation and health check
async function validateProxy(proxyUrl) {
  return new Promise((resolve) => {
    const agent = new HttpsProxyAgent(proxyUrl);
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: '/api/v10/gateway',
      method: 'GET',
      agent: agent,
      timeout: 8000
    };

    const req = https.request(options, (res) => {
      resolve({ proxy: proxyUrl, working: res.statusCode === 200, latency: Date.now() });
    });

    req.on('error', () => resolve({ proxy: proxyUrl, working: false }));
    req.on('timeout', () => { req.destroy(); resolve({ proxy: proxyUrl, working: false }); });
    req.end();
  });
}

// Initialize working proxy list
async function initProxies() {
  if (PROXY_LIST.length === 0) return;
  
  console.log('Testing proxies...');
  const checks = await Promise.all(PROXY_LIST.map(p => validateProxy(p.trim())));
  workingProxies = checks.filter(c => c.working).map(c => c.proxy);
  console.log(`Working proxies: ${workingProxies.length}/${PROXY_LIST.length}`);
}

function getNextProxy() {
  if (workingProxies.length === 0) return null;
  
  // Skip failed proxies, rotate through working ones
  let attempts = 0;
  let proxy;
  
  do {
    proxy = workingProxies[currentProxy];
    currentProxy = (currentProxy + 1) % workingProxies.length;
    attempts++;
  } while (failedProxies.has(proxy) && attempts < workingProxies.length);
  
  // Clear failed list if all proxies marked failed (retry)
  if (attempts >= workingProxies.length) {
    failedProxies.clear();
  }
  
  return proxy;
}

function apiRequest(path, retryCount = 0) {
  return new Promise((resolve) => {
    const proxy = getNextProxy();
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    
    const startTime = Date.now();
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
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      },
      agent: agent,
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latency = Date.now() - startTime;
        
        // Mark proxy as failed if rate limited or error
        if (res.statusCode === 429 || res.statusCode === 403) {
          if (proxy) failedProxies.add(proxy);
        }
        
        // Retry with different proxy on 429 if retries available
        if (res.statusCode === 429 && retryCount < 3 && workingProxies.length > 1) {
          const retryAfter = JSON.parse(data).retry_after || 0;
          setTimeout(() => {
            resolve(apiRequest(path, retryCount + 1));
          }, Math.min(retryAfter * 1000, 5000));
          return;
        }
        
        try { 
          resolve({ 
            status: res.statusCode, 
            data: JSON.parse(data), 
            proxy: proxy,
            latency: latency,
            headers: res.headers
          }); 
        } catch { 
          resolve({ 
            status: res.statusCode, 
            data: data, 
            proxy: proxy,
            latency: latency 
          }); 
        }
      });
    });

    req.on('error', (err) => {
      if (proxy) failedProxies.add(proxy);
      // Auto-retry on connection error with new proxy
      if (retryCount < 2 && workingProxies.length > 1) {
        resolve(apiRequest(path, retryCount + 1));
      } else {
        resolve({ status: 0, error: err.message, proxy: proxy });
      }
    });
    
    req.on('timeout', () => { 
      req.destroy(); 
      if (proxy) failedProxies.add(proxy);
      resolve({ status: 0, timeout: true, proxy: proxy }); 
    });
    
    req.end();
  });
}

// Bulk proxy scraper endpoint (add your sources)
app.get('/api/scrape-proxies', async (req, res) => {
  // Add proxy scraping logic from free proxy lists
  // Returns formatted proxy list
  const scraped = [
    // Format: http://user:pass@host:port
  ];
  res.json({ proxies: scraped, count: scraped.length });
});

// Enhanced mass check with intelligent rotation
app.post('/api/mass-check', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const { usernames, delay = 150 } = req.body;
  const results = { available: [], taken: [], rateLimited: [], errors: [] };
  const startTime = Date.now();
  
  // Process in smaller batches to maximize proxy efficiency
  const batchSize = Math.min(10, workingProxies.length * 2 || 5);
  
  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    
    // Parallel requests with different proxies
    const batchPromises = batch.map(user => apiRequest(`/users/${user}`));
    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach((result, idx) => {
      const user = batch[idx];
      if (result.status === 404) results.available.push(user);
      else if (result.status === 200) results.taken.push(user);
      else if (result.status === 429) results.rateLimited.push({ user, retryAfter: result.data?.retry_after });
      else results.errors.push({ user, status: result.status, error: result.data });
    });
    
    // Dynamic delay based on rate limit headers
    const minDelay = Math.max(delay, 100);
    await new Promise(r => setTimeout(r, minDelay));
  }
  
  res.json({
    ...results,
    total: usernames.length,
    duration: Date.now() - startTime,
    proxies_working: workingProxies.length,
    proxies_failed: failedProxies.size
  });
});

// Proxy health monitor
setInterval(async () => {
  if (workingProxies.length === 0) return;
  const checks = await Promise.all(workingProxies.map(p => validateProxy(p)));
  workingProxies = checks.filter(c => c.working).map(c => c.proxy);
}, 60000); // Recheck every minute

// Initialize
validateToken().then(() => {
  initProxies().then(() => {
    app.listen(PORT, () => console.log(`Port ${PORT} | Working Proxies: ${workingProxies.length}`));
  });
});
