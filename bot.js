const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, Events } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============ CONFIGURACIÓN DE ROLES ============
const OWNER_ROLE_ID = '1200562213195362375';
const ADMIN_ROLE_ID = '1530314208229458102';
const VERIFIED_ROLE_ID = '1530261559429955725';
const USER_ROLE_ID = '1530313975361703978';

// ============ CANALES ============
const LOG_CHANNEL_ID = '1530329506445918400'; // Logs del bot
const JOIN_CHANNEL_ID = '1530329911741649018'; // Entradas
const TICKET_TRANSCRIPT_CHANNEL_ID = '1530516098749956167'; // Transcripciones de tickets

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

function hasPermission(member) {
    return member.roles.cache.has(OWNER_ROLE_ID) || member.roles.cache.has(ADMIN_ROLE_ID);
}

// ============ FUNCIÓN PARA ENVIAR LOGS ============
async function sendLog(guild, message, color = 0x5865F2) {
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setColor(color)
            .setDescription(message)
            .setTimestamp();
        await logChannel.send({ embeds: [embed] }).catch(() => {});
    }
}

// ============ FUNCIÓN PARA ENVIAR TRANSCRIPCIÓN DE TICKET ============
async function sendTicketTranscript(channel, closer) {
    const guild = channel.guild;
    const transcriptChannel = guild.channels.cache.get(TICKET_TRANSCRIPT_CHANNEL_ID);
    if (!transcriptChannel) return;

    try {
        // Obtener mensajes del ticket
        const messages = await channel.messages.fetch({ limit: 100 });
        const transcript = messages.reverse().map(m => 
            `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '(Embed o archivo)'}`
        ).join('\n');

        const embed = new EmbedBuilder()
            .setColor(0xF44336)
            .setTitle('📋 TRANSCRIPCIÓN DE TICKET')
            .addFields(
                { name: '👤 Usuario', value: `<@${channel.name.replace('ticket-', '')}>`, inline: true },
                { name: '🔒 Cerrado por', value: closer, inline: true },
                { name: '📅 Fecha', value: new Date().toLocaleString(), inline: true },
                { name: '📝 Mensajes', value: `${messages.size} mensajes` }
            )
            .setTimestamp();

        await transcriptChannel.send({ embeds: [embed] });
        
        // Enviar el transcript como archivo si es muy largo
        if (transcript.length > 1000) {
            const buffer = Buffer.from(transcript, 'utf-8');
            await transcriptChannel.send({
                files: [{
                    attachment: buffer,
                    name: `transcript-${channel.name}.txt`
                }]
            });
        }

    } catch (error) {
        console.error('[!] Error enviando transcript:', error);
    }
}

client.once('ready', () => {
    isReady = true;
    console.log(`[✅] Bot conectado como ${client.user.tag}`);
    console.log(`[✅] Servidores: ${client.guilds.cache.size}`);
    console.log(`[✅] Owner Role ID: ${OWNER_ROLE_ID}`);
    console.log(`[✅] Admin Role ID: ${ADMIN_ROLE_ID}`);
    console.log(`[✅] Verified Role ID: ${VERIFIED_ROLE_ID}`);
    console.log(`[✅] User Role ID: ${USER_ROLE_ID}`);
    console.log(`[✅] Log Channel: ${LOG_CHANNEL_ID}`);
    console.log(`[✅] Join Channel: ${JOIN_CHANNEL_ID}`);
    console.log(`[✅] Transcript Channel: ${TICKET_TRANSCRIPT_CHANNEL_ID}`);
    
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
        sendLog(guild, '🟢 **Bot iniciado y listo para funcionar**', 0x4CAF50);
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
        await sendLog(message.guild, `📋 ${message.author.tag} usó !verificar`, 0x5865F2);
    }

    // ===== COMANDO: !verificacion (público, UNA SOLA VEZ) =====
    if (command === 'verificacion' || command === 'verificación') {
        const guildId = message.guild.id;
        
        if (verificationData[guildId]?.sent) {
            return message.reply('⚠️ El mensaje de verificación ya ha sido enviado en este servidor.');
        }

        try {
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

            await message.channel.send({ embeds: [embed], components: [row] });
            verificationData[guildId] = { sent: true };
            saveVerification();
            await sendLog(message.guild, `📋 ${message.author.tag} creó el panel de verificación`, 0x4CAF50);

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
            await sendLog(message.guild, `📢 ${message.author.tag} envió un anuncio: ${text.substring(0, 100)}`, 0xFF9800);
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

            await message.channel.send({ embeds: [embed], components: [row] });
            await sendLog(message.guild, `🎫 ${message.author.tag} creó el panel de tickets`, 0x5865F2);

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
        await sendLog(message.guild, `🛡️ ${message.author.tag} ${antiRaidEnabled ? 'activó' : 'desactivó'} Anti-Raid`, 0xFF9800);
    }
});

// ============ INTERACCIONES ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // ===== VERIFICACIÓN =====
    if (interaction.customId === 'verify_member' || interaction.customId === 'rules_accept') {
        try {
            const verifiedRole = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            const userRole = interaction.guild.roles.cache.get(USER_ROLE_ID);
            
            if (verifiedRole) {
                await interaction.member.roles.add(verifiedRole);
                if (userRole) {
                    await interaction.member.roles.remove(userRole).catch(() => {});
                }
                await interaction.reply({
                    content: '✅ ¡Te has verificado correctamente!',
                    ephemeral: true
                });
                await sendLog(interaction.guild, `✅ ${interaction.user.tag} se ha verificado`, 0x4CAF50);
            } else {
                await interaction.reply({
                    content: '❌ No se encontró el rol de verificado. Contacta con un administrador.',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('[!] Error asignando rol:', error);
            await interaction.reply({
                content: '❌ Error al asignar el rol.',
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
                        .setCustomId('claim_ticket')
                        .setLabel('📌 Reclamar Ticket')
                        .setStyle(ButtonStyle.Success),
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
                content: `✅ Ticket creado: <#${channel.id}>`,
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

    // ===== RECLAMAR TICKET =====
    if (interaction.customId === 'claim_ticket') {
        try {
            const hasRole = interaction.member.roles.cache.has(OWNER_ROLE_ID) || 
                            interaction.member.roles.cache.has(ADMIN_ROLE_ID);

            if (!hasRole) {
                return interaction.reply({
                    content: '❌ Solo administradores pueden reclamar tickets.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                content: `📌 **${interaction.user.tag}** ha reclamado este ticket.`,
                ephemeral: false
            });

            // Cambiar el nombre del canal para indicar que está reclamado
            await interaction.channel.setName(`reclamado-${interaction.channel.name.replace('ticket-', '')}`);

            await sendLog(interaction.guild, `📌 ${interaction.user.tag} reclamó el ticket ${interaction.channel.name}`, 0xFF9800);

        } catch (error) {
            console.error('[!] Error reclamando ticket:', error);
            await interaction.reply({
                content: '❌ Error al reclamar el ticket.',
                ephemeral: true
            });
        }
    }

    // ===== CERRAR TICKET =====
    if (interaction.customId === 'close_ticket') {
        try {
            const hasRole = interaction.member.roles.cache.has(OWNER_ROLE_ID) || 
                            interaction.member.roles.cache.has(ADMIN_ROLE_ID);

            if (!hasRole) {
                return interaction.reply({
                    content: '❌ Solo administradores pueden cerrar tickets.',
                    ephemeral: true
                });
            }

            // Enviar transcript antes de cerrar
            await sendTicketTranscript(interaction.channel, interaction.user.tag);

            await interaction.reply({
                content: '⚠️ El ticket se cerrará en 5 segundos...',
                ephemeral: false
            });

            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                    await sendLog(interaction.guild, `🔒 ${interaction.user.tag} cerró un ticket`, 0xF44336);
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
    // Asignar rol de usuario
    try {
        const userRole = member.guild.roles.cache.get(USER_ROLE_ID);
        if (userRole) {
            await member.roles.add(userRole);
            await sendLog(member.guild, `👤 ${member.user.tag} recibió el rol User`, 0x4CAF50);
        }
    } catch (error) {
        console.error('[!] Error asignando rol de usuario:', error);
    }

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
            const channel = member.guild.channels.cache.get(JOIN_CHANNEL_ID) || member.guild.systemChannel;
            if (channel) {
                channel.send(`🛡️ **ALERTA DE RAID**\n${recent.length} usuarios en 1 minuto.\n<@&${ADMIN_ROLE_ID}> <@&${OWNER_ROLE_ID}>`);
                await sendLog(member.guild, `🛡️ Alerta de raid: ${recent.length} usuarios en 1 minuto`, 0xF44336);
            }
        }
    }

    // Registrar entrada y quién invitó
    try {
        const invites = await member.guild.invites.fetch();
        const cachedInvites = invitesData[member.guild.id] || {};
        let inviterName = 'Desconocido';
        let found = false;

        for (const [code, invite] of invites) {
            if (cachedInvites[code] !== undefined && invite.uses > cachedInvites[code]) {
                inviterName = invite.inviter ? invite.inviter.tag : 'Desconocido';
                found = true;
                
                // Guardar estadísticas de invitaciones
                if (!membersHistory[member.guild.id]) membersHistory[member.guild.id] = {};
                if (!membersHistory[member.guild.id].invites) membersHistory[member.guild.id].invites = {};
                if (!membersHistory[member.guild.id].invites[inviterName]) {
                    membersHistory[member.guild.id].invites[inviterName] = 0;
                }
                membersHistory[member.guild.id].invites[inviterName]++;
                saveMembers();
                break;
            }
        }

        // Si no se encontró, intentar con la caché de invitaciones del sistema
        if (!found) {
            try {
                // Verificar si hay alguna invitación creada por algún miembro
                for (const [code, invite] of invites) {
                    if (invite.uses > 0) {
                        inviterName = invite.inviter ? invite.inviter.tag : 'Desconocido';
                        break;
                    }
                }
            } catch (e) {}
        }

        // Actualizar caché de invitaciones
        for (const [code, invite] of invites) {
            cachedInvites[code] = invite.uses;
        }
        invitesData[member.guild.id] = cachedInvites;
        saveInvites();

        // Obtener total de invitaciones del usuario
        const totalInvites = membersHistory[member.guild.id]?.invites?.[inviterName] || 0;

        // Enviar mensaje en el canal de entradas
        const joinChannel = member.guild.channels.cache.get(JOIN_CHANNEL_ID);
        if (joinChannel) {
            const embed = new EmbedBuilder()
                .setColor(0x4CAF50)
                .setTitle('🟢 NUEVO MIEMBRO')
                .setDescription(`**${member.user.tag}** ha entrado al servidor.`)
                .addFields(
                    { name: '👤 Invitado por', value: inviterName, inline: true },
                    { name: '📊 Invitaciones totales', value: `${totalInvites}`, inline: true },
                    { name: '👥 Miembros', value: `${member.guild.memberCount}`, inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            await joinChannel.send({ embeds: [embed] });
        }

        await sendLog(member.guild, `🟢 ${member.user.tag} entró al servidor (Invitado por: ${inviterName})`, 0x4CAF50);

    } catch (error) {
        console.error('[!] Error registrando entrada:', error);
        const joinChannel = member.guild.channels.cache.get(JOIN_CHANNEL_ID);
        if (joinChannel) {
            joinChannel.send(`🟢 **${member.user.tag}** ha entrado al servidor.`);
        }
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    const joinChannel = member.guild.channels.cache.get(JOIN_CHANNEL_ID);
    if (joinChannel) {
        const embed = new EmbedBuilder()
            .setColor(0xF44336)
            .setTitle('🔴 SALIDA')
            .setDescription(`**${member.user.tag}** ha salido del servidor.`)
            .addFields(
                { name: '👥 Miembros', value: `${member.guild.memberCount}`, inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();

        await joinChannel.send({ embeds: [embed] });
    }
    await sendLog(member.guild, `🔴 ${member.user.tag} salió del servidor`, 0xF44336);
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