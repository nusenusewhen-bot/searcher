const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Discord API configuration
const DISCORD_API = 'https://discord.com/api/v9';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // User account token required

// Check single username availability
app.get('/api/check/:username', async (req, res) => {
    const { username } = req.params;
    
    try {
        const response = await axios.get(`${DISCORD_API}/users/@me`, {
            headers: {
                'Authorization': DISCORD_TOKEN,
                'Content-Type': 'application/json'
            },
            // Alternative: Check username via registration flow simulation
        });

        // Discord doesn't have a public endpoint for username checking
        // Workaround: Attempt registration check or profile lookup
        const checkResponse = await axios.post(
            `${DISCORD_API}/auth/register/check-username`,
            { username: username },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        );

        res.json({
            username: username,
            available: checkResponse.data.available || false,
            taken: checkResponse.data.taken || true
        });

    } catch (error) {
        // If 400/409, username likely taken
        // If 200, might be available
        res.json({
            username: username,
            available: error.response?.status === 200,
            error: error.response?.data?.message || 'Check failed'
        });
    }
});

// Batch check usernames
app.post('/api/check-batch', async (req, res) => {
    const { usernames } = req.body;
    const results = [];

    for (const username of usernames) {
        try {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit protection
            
            const response = await axios.post(
                `${DISCORD_API}/auth/register/check-username`,
                { username: username },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }
            );
            
            results.push({
                username,
                available: response.data.available,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            results.push({
                username,
                available: false,
                taken: true,
                error: error.message
            });
        }
    }

    res.json({ results });
});

// Generate username patterns
app.get('/api/generate/:type', (req, res) => {
    const { type } = req.params; // '3', '4', 'any'
    const count = parseInt(req.query.count) || 10;
    const usernames = [];

    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
    
    for (let i = 0; i < count; i++) {
        let username = '';
        const length = type === '3' ? 3 : type === '4' ? 4 : Math.floor(Math.random() * 5) + 3;
        
        for (let j = 0; j < length; j++) {
            username += chars[Math.floor(Math.random() * chars.length)];
        }
        
        usernames.push(username);
    }

    res.json({ usernames, type, generated: count });
});

// Start server
app.listen(PORT, () => {
    console.log(`Discord Username Checker running on port ${PORT}`);
});
