const express = require('express');
const { request } = require('undici');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

app.use(express.json());
app.use(express.static('public'));

// Check username via Discord's friends lookup endpoint
app.get('/api/check/:username', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'No token' });
  
  const username = req.params.username;
  
  try {
    // Try to lookup user by username - 200 means exists, 404 means available
    const { statusCode, body } = await request(
      `https://discord.com/api/v9/users/${username}`, 
      {
        headers: {
          'Authorization': TOKEN,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    await body.dump(); // drain body
    
    // 404 = username available, 200 = taken
    res.json({
      username,
      available: statusCode === 404,
      status: statusCode
    });
    
  } catch (err) {
    res.json({ username, available: false, error: err.message });
  }
});

// Generate usernames
app.get('/api/gen/:len/:count', (req, res) => {
  const len = parseInt(req.params.len) || 4;
  const count = Math.min(parseInt(req.params.count) || 20, 50);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  
  const names = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    for (let j = 0; j < len; j++) {
      name += chars[Math.floor(Math.random() * chars.length)];
    }
    names.push(name);
  }
  
  res.json({ usernames: names, length: len, count });
});

// Batch check with delay
app.post('/api/batch', async (req, res) => {
  const { usernames } = req.body;
  if (!Array.isArray(usernames)) return res.status(400).json({ error: 'Array required' });
  
  const results = [];
  
  for (const user of usernames.slice(0, 30)) {
    try {
      const { statusCode, body } = await request(
        `https://discord.com/api/v9/users/${user}`,
        {
          headers: {
            'Authorization': TOKEN,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );
      await body.dump();
      
      results.push({
        username: user,
        available: statusCode === 404,
        checked: new Date().toISOString()
      });
      
      // Rate limit protection
      await new Promise(r => setTimeout(r, 500));
      
    } catch (e) {
      results.push({ username: user, available: false, error: e.message });
    }
  }
  
  res.json({ results, total: results.length });
});

app.listen(PORT, () => console.log(`Live on port ${PORT}`));
