const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// ============ CONFIGURACIÓN ============
// ⚠️ REEMPLAZA ESTO CON TU NUEVO TOKEN (NO LO COMPARTAS)
const TOKEN = process.env.DISCORD_TOKEN || 'PON_AQUI_TU_TOKEN';
const ROLE_ID = process.env.ROLE_ID || '1530261559429955725';
const PORT = process.env.PORT || 3000;

// ============ CLIENTE DE DISCORD ============
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let isReady = false;

client.once('ready', () => {
    isReady = true;
    console.log(`[✅] Bot conectado como ${client.user.tag}`);
    console.log(`[✅] Servidores: ${client.guilds.cache.size}`);
    console.log(`[✅] Rol permitido ID: ${ROLE_ID}`);
    
    client.guilds.cache.forEach(guild => {
        console.log(`[📁] Servidor: ${guild.name} (ID: ${guild.id})`);
    });
});

// ============ COMANDOS ============
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (message.content === '!verificar' || message.content === '!rol') {
        const member = message.member;
        if (!member) return;
        
        const hasRole = member.roles.cache.has(ROLE_ID);
        
        if (hasRole) {
            message.reply('✅ Tienes el rol de administrador. Puedes acceder al panel.');
        } else {
            message.reply('❌ No tienes el rol de administrador. Contacta con un admin.');
        }
    }
});

// ============ API PARA VERIFICAR ROLES ============
const app = express();

app.get('/health', (req, res) => {
    res.json({
        status: isReady ? 'online' : 'connecting',
        bot: client.user?.tag || 'offline',
        guilds: client.guilds.cache.size || 0,
        role_id: ROLE_ID
    });
});

app.get('/api/check-role/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const guild = client.guilds.cache.first();
        if (!guild) {
            return res.status(500).json({ error: 'Bot no está en ningún servidor' });
        }
        
        const member = await guild.members.fetch(userId);
        if (!member) {
            return res.json({ hasRole: false, error: 'Usuario no encontrado' });
        }
        
        const hasRole = member.roles.cache.has(ROLE_ID);
        res.json({
            hasRole,
            username: member.user.username,
            displayName: member.displayName
        });
    } catch (error) {
        res.json({ hasRole: false, error: error.message });
    }
});

app.get('/api/members-with-role', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) {
            return res.status(500).json({ error: 'Bot no está en ningún servidor' });
        }
        
        const members = await guild.members.fetch();
        const filtered = members.filter(m => m.roles.cache.has(ROLE_ID));
        const result = filtered.map(m => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName
        }));
        
        res.json(result);
    } catch (error) {
        res.json({ error: error.message });
    }
});

// ============ INICIAR BOT Y SERVIDOR ============
client.login(TOKEN);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[✅] API del bot corriendo en puerto ${PORT}`);
    console.log(`[✅] Health: http://0.0.0.0:${PORT}/health`);
});
