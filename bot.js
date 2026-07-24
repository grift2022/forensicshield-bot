const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, Events } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============ CONFIGURACIÓN DE ROLES ============
const OWNER_ROLE_ID = '1200562213195362375';
const ADMIN_ROLE_ID = '1530314208229458102';
const VERIFIED_ROLE_ID = '1530261559429955725'; // Comprado/Verificado
const USER_ROLE_ID = '1530313975361703978';     // User/No verificado

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 10000;

// ============ ARCHIVOS DE DATOS ============
const DATA_DIR = path.join(__dirname, 'data');
const INVITES_FILE = path.join(DATA_DIR, 'invites.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const VERIFICATION_FILE = path.join(DATA_DIR, 'verification.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

let invitesData = {};
if (fs.existsSync(INVITES_FILE)) {
    try { invitesData = JSON.parse(fs.readFileSync(INVITES_FILE)); } catch { invitesData = {}; }
}

let membersHistory = {};
if (fs.existsSync(MEMBERS_FILE)) {
    try { membersHistory = JSON.parse(fs.readFileSync(MEMBERS_FILE)); } catch { membersHistory = {}; }
}

let verificationData = {};
if (fs.existsSync(VERIFICATION_FILE)) {
    try { verificationData = JSON.parse(fs.readFileSync(VERIFICATION_FILE)); } catch { verificationData = {}; }
}

function saveInvites() { fs.writeFileSync(INVITES_FILE, JSON.stringify(invitesData, null, 2)); }
function saveMembers() { fs.writeFileSync(MEMBERS_FILE, JSON.stringify(membersHistory, null, 2)); }
function saveVerification() { fs.writeFileSync(VERIFICATION_FILE, JSON.stringify(verificationData, null, 2)); }

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
let joinLogChannel = null;
let leaveLogChannel = null;

// ============ FUNCIÓN PARA VERIFICAR PERMISOS ============
function hasPermission(member) {
    return member.roles.cache.has(OWNER_ROLE_ID) || member.roles.cache.has(ADMIN_ROLE_ID);
}

client.once('ready', () => {
    isReady = true;
    console.log(`[✅] Bot conectado como ${client.user.tag}`);
    console.log(`[✅] Servidores: ${client.guilds.cache.size}`);
    console.log(`[✅] Owner Role ID: ${OWNER_ROLE_ID}`);
    console.log(`[✅] Admin Role ID: ${ADMIN_ROLE_ID}`);
    console.log(`[✅] Verified Role ID: ${VERIFIED_ROLE_ID}`);
    console.log(`[✅] User Role ID: ${USER_ROLE_ID}`);
    
    client.guilds.cache.forEach(guild => {
        console.log(`[📁] Servidor: ${guild.name} (ID: ${guild.id})`);
        if (!invitesData[guild.id]) {
            invitesData[guild.id] = {};
        }
        if (!verificationData[guild.id]) {
            verificationData[guild.id] = { sent: false };
        }
        saveInvites();
        saveVerification();
    });
});

// ============ COMANDOS ============
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ===== COMANDO: !verificar (público) =====
    if (command === 'verificar' || command === 'rol') {
        const member = message.member;
        if (!member) return;
        
        const isOwner = member.roles.cache.has(OWNER_ROLE_ID);
        const isAdmin = member.roles.cache.has(ADMIN_ROLE_ID);
        const isVerified = member.roles.cache.has(VERIFIED_ROLE_ID);
        
        let response = '📋 **Tu información:**\n';
        response += `• Owner: ${isOwner ? '✅ Sí' : '❌ No'}\n`;
        response += `• Admin: ${isAdmin ? '✅ Sí' : '❌ No'}\n`;
        response += `• Verificado: ${isVerified ? '✅ Sí' : '❌ No'}`;
        
        message.reply(response);
    }

    // ===== COMANDO: !invitaciones (público) =====
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
                .setTimestamp();

            let description = '';
            const sortedInvites = invites.sort((a, b) => b.uses - a.uses);
            
            sortedInvites.forEach((invite, index) => {
                const inviter = invite.inviter ? invite.inviter.username : 'Desconocido';
                const uses = invite.uses || 0;
                
                description += `**#${index + 1}** 👤 ${inviter} → ${uses} usos\n`;
            });

            embed.setDescription(description || 'No hay invitaciones activas.');
            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!] Error en !invitaciones:', error);
            message.reply('❌ Error al obtener las invitaciones.');
        }
    }

    // ===== COMANDO: !verificacion (público, UNA SOLA VEZ) =====
    if (command === 'verificacion' || command === 'verificación') {
        const guildId = message.guild.id;
        
        // Verificar si ya se envió el mensaje de verificación en este servidor
        if (verificationData[guildId]?.sent) {
            return message.reply('⚠️ El mensaje de verificación ya ha sido enviado en este servidor. Si necesitas reenviarlo, contacta con un administrador.');
        }

        try {
            // Eliminar el mensaje del usuario
            await message.delete().catch(() => {});

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🔐 VERIFICACIÓN DE MIEMBROS')
                .setDescription('Haz clic en el botón de abajo para verificar tu identidad.')
                .addFields(
                    { name: '📋 Reglas', value: '1. No hacer spam\n2. Respetar a los miembros\n3. Seguir las instrucciones de los administradores' },
                    { name: '✅ Beneficios', value: '• Acceso a todos los canales\n• Participar en eventos' }
                )
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_member')
                        .setLabel('✅ Verificarme')
                        .setStyle(ButtonStyle.Success)
                );

            await message.channel.send({
                embeds: [embed],
                components: [row]
            });

            // Marcar como enviado
            verificationData[guildId] = { sent: true };
            saveVerification();

        } catch (error) {
            console.error('[!] Error en !verificacion:', error);
            message.reply('❌ Error al crear el panel de verificación.');
        }
    }

    // ===== COMANDO: !anuncio (solo Owner y Admin) =====
    if (command === 'anuncio') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        const text = args.join(' ');
        if (!text) {
            return message.reply('❌ Uso correcto: `!anuncio <mensaje>`');
        }

        try {
            await message.channel.send(text);
            try { await message.delete(); } catch (e) {}
        } catch (error) {
            console.error('[!] Error en !anuncio:', error);
            message.reply('❌ Error al enviar el anuncio.');
        }
    }

    // ===== COMANDO: !ticket (solo Owner y Admin) =====
    if (command === 'ticket') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            try { await message.delete(); } catch (e) {}

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎫 Sistema de Tickets')
                .setDescription('Haz clic en el botón para abrir un ticket de soporte.')
                .setFooter({ text: 'Sistema de Tickets - ForensicShield' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('create_ticket')
                        .setLabel('🎫 Crear Ticket')
                        .setStyle(ButtonStyle.Primary)
                );

            await message.channel.send({
                embeds: [embed],
                components: [row]
            });

        } catch (error) {
            console.error('[!] Error en !ticket:', error);
            message.reply('❌ Error al crear el panel de tickets.');
        }
    }

    // ===== COMANDO: !anti-raid (solo Owner) =====
    if (command === 'anti-raid' || command === 'antiraid') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        antiRaidEnabled = !antiRaidEnabled;
        message.channel.send(antiRaidEnabled ? '🛡️ **Anti-Raid ACTIVADO**' : '🛡️ **Anti-Raid DESACTIVADO**');
    }

    // ===== COMANDO: !llegadas (solo Owner) =====
    if (command === 'llegadas') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            try { await message.delete(); } catch (e) {}

            // Usar el canal donde se ejecutó el comando
            const channel = message.channel;
            joinLogChannel = channel.id;
            leaveLogChannel = channel.id;

            const embed = new EmbedBuilder()
                .setColor(0x2196F3)
                .setTitle('📋 SISTEMA DE ENTRADAS Y SALIDAS ACTIVADO')
                .setDescription(`Se mostrarán en <#${channel.id}> las entradas y salidas de miembros.`)
                .setTimestamp();

            await message.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('[!] Error en !llegadas:', error);
            message.reply('❌ Error al activar el sistema de logs.');
        }
    }

    // ===== COMANDO: !logs (solo Owner) =====
    if (command === 'logs' || command === 'log') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            const guild = message.guild;
            
            // Obtener todos los logs del servidor
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📋 LOGS DEL SERVIDOR')
                .setDescription(`Logs disponibles para ${guild.name}`)
                .addFields(
                    { name: '👥 Miembros', value: `${guild.memberCount}`, inline: true },
                    { name: '📁 Canales', value: `${guild.channels.cache.size}`, inline: true },
                    { name: '🎭 Roles', value: `${guild.roles.cache.size}`, inline: true }
                )
                .setTimestamp();

            // Logs de invitaciones
            let inviteLog = 'No hay invitaciones activas.';
            const invites = await guild.invites.fetch();
            if (invites.size > 0) {
                const sorted = invites.sort((a, b) => b.uses - a.uses);
                inviteLog = sorted.map((inv, i) => 
                    `**#${i+1}** ${inv.inviter?.username || 'Desconocido'} → ${inv.uses} usos`
                ).join('\n');
                if (inviteLog.length > 1000) inviteLog = inviteLog.substring(0, 1000) + '...';
            }

            embed.addFields({ name: '📊 Invitaciones', value: inviteLog });

            // Logs de miembros recientes
            const members = await guild.members.fetch();
            const recentMembers = members
                .sort((a, b) => b.joinedAt - a.joinedAt)
                .slice(0, 10);

            let memberLog = recentMembers.map(m => 
                `👤 ${m.user.tag} (${m.joinedAt?.toLocaleDateString() || 'Fecha desconocida'})`
            ).join('\n');

            embed.addFields({ name: '🆕 Últimos 10 miembros', value: memberLog || 'No hay datos' });

            // Logs de entradas/salidas
            if (membersHistory[guild.id]?.joins?.length > 0) {
                const joins = membersHistory[guild.id].joins.slice(-10);
                const joinLog = joins.map(t => 
                    `📥 Entrada: ${new Date(t).toLocaleString()}`
                ).join('\n');
                embed.addFields({ name: '📥 Últimas entradas', value: joinLog });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!] Error en !logs:', error);
            message.reply('❌ Error al obtener los logs.');
        }
    }
});

// ============ INTERACCIONES ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // ===== VERIFICACIÓN =====
    if (interaction.customId === 'verify_member' || interaction.customId === 'rules_accept') {
        try {
            // Asignar rol de verificado
            const verifiedRole = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            const userRole = interaction.guild.roles.cache.get(USER_ROLE_ID);
            
            if (verifiedRole) {
                await interaction.member.roles.add(verifiedRole);
                // Remover el rol de usuario no verificado si existe
                if (userRole) {
                    await interaction.member.roles.remove(userRole).catch(() => {});
                }
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
        } catch (error) {
            console.error('[!] Error asignando rol:', error);
            await interaction.reply({
                content: '❌ Error al asignar el rol. Asegúrate de que el bot tiene permisos de gestionar roles.',
                ephemeral: true
            });
        }
    }

    // ===== CREAR TICKET =====
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
                        { id: OWNER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
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
                    { id: OWNER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎫 Nuevo Ticket')
                .setDescription(`Bienvenido ${interaction.user}, un administrador te atenderá pronto.`)
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('🔒 Cerrar Ticket')
                        .setStyle(ButtonStyle.Danger)
                );

            await channel.send({
                content: `<@${interaction.user.id}> <@&${OWNER_ROLE_ID}> <@&${ADMIN_ROLE_ID}>`,
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
                content: '❌ Error al crear el ticket. Asegúrate de que el bot tiene permisos de gestionar canales.',
                ephemeral: true
            });
        }
    }

    // ===== CERRAR TICKET =====
    if (interaction.customId === 'close_ticket') {
        try {
            const isOwner = interaction.channel.name === `ticket-${interaction.user.id}`;
            const hasRole = interaction.member.roles.cache.has(OWNER_ROLE_ID) || interaction.member.roles.cache.has(ADMIN_ROLE_ID);

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

// ============ EVENTOS DE ENTRADA Y SALIDA ============
client.on(Events.GuildMemberAdd, async (member) => {
    // Anti-raid
    if (antiRaidEnabled) {
        const now = Date.now();
        const timeWindow = 60000;
        const maxJoins = 5;

        const recentJoins = membersHistory[member.guild.id]?.joins || [];
        const recent = recentJoins.filter(t => now - t < timeWindow);
        recent.push(now);
        membersHistory[member.guild.id] = membersHistory[member.guild.id] || {};
        membersHistory[member.guild.id].joins = recent;
        saveMembers();

        if (recent.length > maxJoins) {
            const channel = member.guild.channels.cache.find(ch => ch.name === 'logs-entradas-salidas') || member.guild.systemChannel;
            if (channel) {
                channel.send(`🛡️ **ALERTA DE RAID**\n${recent.length} usuarios en 1 minuto.\n<@&${ADMIN_ROLE_ID}> <@&${OWNER_ROLE_ID}>`);
            }
        }
    }

    // Log de entrada
    if (joinLogChannel) {
        const channel = member.guild.channels.cache.get(joinLogChannel);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0x4CAF50)
                .setTitle('🟢 ENTRADA')
                .setDescription(`**${member.user.tag}** ha entrado al servidor.`)
                .addFields(
                    { name: '👥 Miembros', value: `${member.guild.memberCount}`, inline: true },
                    { name: '📅 Cuenta creada', value: member.user.createdAt.toLocaleDateString(), inline: true }
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
        
        for (const [code, invite] of invites) {
            if (cachedInvites[code] !== undefined && invite.uses > cachedInvites[code]) {
                const inviter = invite.inviter ? invite.inviter.username : 'Desconocido';
                
                if (!membersHistory[member.guild.id]) membersHistory[member.guild.id] = {};
                if (!membersHistory[member.guild.id].invites) membersHistory[member.guild.id].invites = {};
                if (!membersHistory[member.guild.id].invites[inviter]) {
                    membersHistory[member.guild.id].invites[inviter] = 0;
                }
                membersHistory[member.guild.id].invites[inviter]++;
                saveMembers();

                if (joinLogChannel) {
                    const channel = member.guild.channels.cache.get(joinLogChannel);
                    if (channel) {
                        channel.send(`📨 **${member.user.tag}** fue invitado por **${inviter}** (Código: ${code})`);
                    }
                }
                break;
            }
        }

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
    if (leaveLogChannel) {
        const channel = member.guild.channels.cache.get(leaveLogChannel);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0xF44336)
                .setTitle('🔴 SALIDA')
                .setDescription(`**${member.user.tag}** ha salido del servidor.`)
                .addFields(
                    { name: '👥 Miembros', value: `${member.guild.memberCount}`, inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            channel.send({ embeds: [embed] });
        }
    }
});

// ============ API ============
const app = express();

app.get('/health', (req, res) => {
    res.json({
        status: isReady ? 'online' : 'connecting',
        bot: client.user?.tag || 'offline',
        guilds: client.guilds.cache.size || 0,
        role_id: OWNER_ROLE_ID,
        anti_raid: antiRaidEnabled
    });
});

app.get('/api/check-role/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return res.status(500).json({ error: 'Bot no está en ningún servidor' });
        const member = await guild.members.fetch(userId);
        if (!member) return res.json({ hasRole: false });
        res.json({ hasRole: member.roles.cache.has(OWNER_ROLE_ID), username: member.user.username });
    } catch {
        res.json({ hasRole: false });
    }
});

// ============ INICIAR ============
client.login(TOKEN);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[✅] API del bot corriendo en puerto ${PORT}`);
});

// Auto-ping cada 5 minutos
setInterval(async () => {
    try {
        await fetch(`http://localhost:${PORT}/health`);
    } catch (e) {}
}, 300000);