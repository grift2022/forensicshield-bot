const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, Events } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============ CONFIGURACIÓN ============
const TOKEN = process.env.DISCORD_TOKEN;
const ROLE_ID = process.env.ROLE_ID || '1530261559429955725';
const PORT = process.env.PORT || 10000;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'ID_DEL_ROL_VERIFICADO';

// ============ ARCHIVOS DE DATOS ============
const DATA_DIR = path.join(__dirname, 'data');
const INVITES_FILE = path.join(DATA_DIR, 'invites.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');

// Asegurar que la carpeta data existe
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Cargar datos de invitaciones
let invitesData = {};
if (fs.existsSync(INVITES_FILE)) {
    try {
        invitesData = JSON.parse(fs.readFileSync(INVITES_FILE));
    } catch { invitesData = {}; }
}

// Cargar historial de miembros
let membersHistory = {};
if (fs.existsSync(MEMBERS_FILE)) {
    try {
        membersHistory = JSON.parse(fs.readFileSync(MEMBERS_FILE));
    } catch { membersHistory = {}; }
}

// Guardar datos
function saveInvites() {
    fs.writeFileSync(INVITES_FILE, JSON.stringify(invitesData, null, 2));
}

function saveMembers() {
    fs.writeFileSync(MEMBERS_FILE, JSON.stringify(membersHistory, null, 2));
}

// ============ CLIENTE DE DISCORD ============
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ]
});

let isReady = false;
let antiRaidEnabled = false;
let raidDetectionTime = 0;
let joinLogChannel = null;
let leaveLogChannel = null;

client.once('ready', () => {
    isReady = true;
    console.log(`[✅] Bot conectado como ${client.user.tag}`);
    console.log(`[✅] Servidores: ${client.guilds.cache.size}`);
    console.log(`[✅] Rol permitido ID: ${ROLE_ID}`);
    
    client.guilds.cache.forEach(guild => {
        console.log(`[📁] Servidor: ${guild.name} (ID: ${guild.id})`);
        // Inicializar datos de invitaciones
        if (!invitesData[guild.id]) {
            invitesData[guild.id] = {};
        }
        saveInvites();
    });
});

// ============ COMANDOS ============
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Verificar permisos de admin para comandos de administración
    const isAdmin = message.member.roles.cache.has(ROLE_ID);

    // ===== COMANDO: !verificar =====
    if (command === 'verificar' || command === 'rol') {
        const member = message.member;
        if (!member) return;
        
        const hasRole = member.roles.cache.has(ROLE_ID);
        
        if (hasRole) {
            message.reply('✅ Tienes el rol de administrador. Puedes acceder al panel.');
        } else {
            message.reply('❌ No tienes el rol de administrador. Contacta con un admin.');
        }
    }

    // ===== COMANDO: !verificacion (RB3 Guard style) =====
    if (command === 'verificacion' || command === 'verificación') {
        if (!isAdmin) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            await message.delete().catch(() => {});

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🔐 VERIFICACIÓN DE MIEMBROS')
                .setDescription('Para acceder al servidor, debes verificar tu identidad.\n\n**Instrucciones:**\n1. Haz clic en el botón de abajo\n2. Lee y acepta las reglas\n3. Recibirás el rol de miembro verificado')
                .addFields(
                    { name: '📋 Reglas del servidor', value: '1. No hacer spam\n2. Respetar a los miembros\n3. No compartir información personal\n4. Seguir las instrucciones de los administradores' },
                    { name: '✅ Beneficios de verificar', value: '• Acceso a todos los canales\n• Participar en eventos\n• Acceder al sistema de tickets' }
                )
                .setFooter({ text: 'Sistema de Verificación - ForensicShield' })
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_member')
                        .setLabel('✅ Verificarme')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('rules_accept')
                        .setLabel('📋 Aceptar Reglas')
                        .setStyle(ButtonStyle.Primary)
                );

            await message.channel.send({
                embeds: [embed],
                components: [row]
            });

        } catch (error) {
            console.error('[!] Error en !verificacion:', error);
            message.reply('❌ Error al crear el panel de verificación.');
        }
    }

    // ===== COMANDO: !anti-raid =====
    if (command === 'anti-raid' || command === 'antiraid') {
        if (!isAdmin) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        antiRaidEnabled = !antiRaidEnabled;
        if (antiRaidEnabled) {
            raidDetectionTime = Date.now();
            message.channel.send('🛡️ **Anti-Raid ACTIVADO**\nSe monitorearán las entradas masivas de usuarios.');
        } else {
            message.channel.send('🛡️ **Anti-Raid DESACTIVADO**');
        }
    }

    // ===== COMANDO: !invitaciones =====
    if (command === 'invitaciones' || command === 'invites') {
        try {
            const guild = message.guild;
            const invites = await guild.invites.fetch();
            
            if (invites.size === 0) {
                return message.reply('📊 No hay invitaciones activas en este servidor.');
            }

            const embed = new EmbedBuilder()
                .setColor(0x4CAF50)
                .setTitle('📊 RANKING DE INVITACIONES')
                .setDescription('Lista de invitaciones activas en el servidor')
                .setTimestamp();

            let description = '';
            const sortedInvites = invites.sort((a, b) => b.uses - a.uses);
            
            sortedInvites.forEach((invite, index) => {
                const inviter = invite.inviter ? invite.inviter.username : 'Desconocido';
                const uses = invite.uses || 0;
                const code = invite.code;
                const channel = invite.channel ? `#${invite.channel.name}` : 'Canal desconocido';
                
                description += `**#${index + 1}** 👤 ${inviter}\n`;
                description += `└ 📌 ${uses} usos | Código: \`${code}\` | Canal: ${channel}\n\n`;
            });

            embed.setDescription(description);
            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!] Error en !invitaciones:', error);
            message.reply('❌ Error al obtener las invitaciones.');
        }
    }

    // ===== COMANDO: !llegadas =====
    if (command === 'llegadas') {
        if (!isAdmin) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            await message.delete().catch(() => {});

            // Buscar o crear canal de logs
            let logChannel = message.guild.channels.cache.find(ch => ch.name === 'logs-entradas-salidas');
            if (!logChannel) {
                logChannel = await message.guild.channels.create({
                    name: 'logs-entradas-salidas',
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: message.guild.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: ROLE_ID,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                        }
                    ]
                });
            }

            joinLogChannel = logChannel.id;
            leaveLogChannel = logChannel.id;

            const embed = new EmbedBuilder()
                .setColor(0x2196F3)
                .setTitle('📋 SISTEMA DE ENTRADAS Y SALIDAS ACTIVADO')
                .setDescription(`Se mostrarán en <#${logChannel.id}> las entradas y salidas de miembros.`)
                .setTimestamp();

            await message.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('[!] Error en !llegadas:', error);
            message.reply('❌ Error al activar el sistema de logs.');
        }
    }
});

// ============ EVENTOS DE ENTRADA Y SALIDA ============
client.on(Events.GuildMemberAdd, async (member) => {
    // Anti-raid detection
    if (antiRaidEnabled) {
        const now = Date.now();
        const timeWindow = 60000; // 1 minuto
        const maxJoins = 5; // Máximo 5 entradas por minuto

        // Contar entradas en la ventana de tiempo
        const recentJoins = membersHistory[member.guild.id]?.joins || [];
        const recent = recentJoins.filter(t => now - t < timeWindow);
        recent.push(now);
        membersHistory[member.guild.id] = membersHistory[member.guild.id] || {};
        membersHistory[member.guild.id].joins = recent;
        saveMembers();

        if (recent.length > maxJoins) {
            // Posible raid - notificar a los admins
            const adminRole = member.guild.roles.cache.get(ROLE_ID);
            if (adminRole) {
                const channel = member.guild.channels.cache.find(ch => ch.name === 'logs-entradas-salidas') || member.guild.systemChannel;
                if (channel) {
                    channel.send(`🛡️ **ALERTA DE RAID DETECTADO**\n${recent.length} usuarios han entrado en el último minuto.\n@${adminRole.name} revisar inmediatamente.`);
                }
            }
        }
    }

    // Registrar entrada
    if (joinLogChannel) {
        const channel = member.guild.channels.cache.get(joinLogChannel);
        if (channel) {
            const memberCount = member.guild.memberCount;
            const embed = new EmbedBuilder()
                .setColor(0x4CAF50)
                .setTitle('🟢 ENTRADA')
                .setDescription(`**${member.user.tag}** ha entrado al servidor.`)
                .addFields(
                    { name: '📅 Creación de cuenta', value: member.user.createdAt.toLocaleDateString(), inline: true },
                    { name: '👥 Miembros totales', value: `${memberCount}`, inline: true },
                    { name: '🆔 ID', value: member.id, inline: false }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            channel.send({ embeds: [embed] });
        }
    }

    // Registrar invitación
    try {
        const invites = await member.guild.invites.fetch();
        const cachedInvites = invitesData[member.guild.id] || {};
        
        // Buscar qué invitación se usó
        for (const [code, invite] of invites) {
            if (cachedInvites[code] !== undefined && invite.uses > cachedInvites[code]) {
                const inviter = invite.inviter ? invite.inviter.username : 'Desconocido';
                
                // Guardar en el historial de invitaciones
                if (!membersHistory[member.guild.id]) membersHistory[member.guild.id] = {};
                if (!membersHistory[member.guild.id].invites) membersHistory[member.guild.id].invites = {};
                if (!membersHistory[member.guild.id].invites[inviter]) {
                    membersHistory[member.guild.id].invites[inviter] = 0;
                }
                membersHistory[member.guild.id].invites[inviter]++;
                saveMembers();

                // Notificar en el canal de logs
                if (joinLogChannel) {
                    const channel = member.guild.channels.cache.get(joinLogChannel);
                    if (channel) {
                        channel.send(`📨 **${member.user.tag}** fue invitado por **${inviter}** (Código: ${code})`);
                    }
                }
                break;
            }
        }

        // Actualizar caché de invitaciones
        for (const [code, invite] of invites) {
            cachedInvites[code] = invite.uses;
        }
        invitesData[member.guild.id] = cachedInvites;
        saveInvites();

    } catch (error) {
        console.error('[!] Error registrando invitación:', error);
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    // Registrar salida
    if (leaveLogChannel) {
        const channel = member.guild.channels.cache.get(leaveLogChannel);
        if (channel) {
            const memberCount = member.guild.memberCount;
            const embed = new EmbedBuilder()
                .setColor(0xF44336)
                .setTitle('🔴 SALIDA')
                .setDescription(`**${member.user.tag}** ha salido del servidor.`)
                .addFields(
                    { name: '⏱️ Tiempo en el servidor', value: 'No disponible', inline: true },
                    { name: '👥 Miembros totales', value: `${memberCount}`, inline: true },
                    { name: '🆔 ID', value: member.id, inline: false }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            channel.send({ embeds: [embed] });
        }
    }
});

// ============ INTERACCIONES (BOTONES) ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // ===== VERIFICACIÓN =====
    if (interaction.customId === 'verify_member') {
        const role = interaction.guild.roles.cache.find(r => r.name === 'Verificado' || r.id === VERIFIED_ROLE_ID);
        if (role) {
            await interaction.member.roles.add(role);
            await interaction.reply({
                content: '✅ ¡Te has verificado correctamente! Ahora tienes acceso al servidor.',
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: '❌ No se encontró el rol de verificado. Contacta con un administrador.',
                ephemeral: true
            });
        }
    }

    if (interaction.customId === 'rules_accept') {
        const role = interaction.guild.roles.cache.find(r => r.name === 'Verificado' || r.id === VERIFIED_ROLE_ID);
        if (role) {
            await interaction.member.roles.add(role);
            await interaction.reply({
                content: '✅ Has aceptado las reglas y te has verificado. ¡Bienvenido!',
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: '❌ No se encontró el rol de verificado. Contacta con un administrador.',
                ephemeral: true
            });
        }
    }

    // ===== TICKETS =====
    if (interaction.customId === 'create_ticket') {
        try {
            const guild = interaction.guild;
            const existingChannel = guild.channels.cache.find(
                ch => ch.name === `ticket-${interaction.user.id}` && ch.parent?.name === 'Tickets'
            );

            if (existingChannel) {
                return interaction.reply({
                    content: '⚠️ Ya tienes un ticket abierto: <#' + existingChannel.id + '>',
                    ephemeral: true
                });
            }

            let category = guild.channels.cache.find(ch => ch.name === 'Tickets' && ch.type === ChannelType.GuildCategory);
            if (!category) {
                category = await guild.channels.create({
                    name: 'Tickets',
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });
            }

            const channel = await guild.channels.create({
                name: `ticket-${interaction.user.id}`,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎫 Nuevo Ticket')
                .setDescription(`Bienvenido ${interaction.user}, un administrador te atenderá pronto.\n\nDescribe tu problema para ayudarte mejor.`)
                .setFooter({ text: `ID del ticket: ${interaction.user.id}` })
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('🔒 Cerrar Ticket')
                        .setStyle(ButtonStyle.Danger)
                );

            await channel.send({
                content: `<@${interaction.user.id}> <@&${ROLE_ID}>`,
                embeds: [embed],
                components: [row]
            });

            await interaction.reply({
                content: `✅ Ticket creado correctamente: <#${channel.id}>`,
                ephemeral: true
            });

        } catch (error) {
            console.error('[!] Error creando ticket:', error);
            await interaction.reply({
                content: '❌ Error al crear el ticket.',
                ephemeral: true
            });
        }
    }

    // ===== CERRAR TICKET =====
    if (interaction.customId === 'close_ticket') {
        try {
            const isOwner = interaction.channel.name === `ticket-${interaction.user.id}`;
            const hasRole = interaction.member.roles.cache.has(ROLE_ID);

            if (!isOwner && !hasRole) {
                return interaction.reply({
                    content: '❌ No tienes permiso para cerrar este ticket.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                content: '⚠️ El ticket se cerrará en 5 segundos...',
                ephemeral: false
            });

            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (error) {
                    console.error('[!] Error eliminando canal:', error);
                }
            }, 5000);

        } catch (error) {
            console.error('[!] Error cerrando ticket:', error);
            await interaction.reply({
                content: '❌ Error al cerrar el ticket.',
                ephemeral: true
            });
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
        role_id: ROLE_ID,
        anti_raid: antiRaidEnabled,
        invites: Object.keys(invitesData).length
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