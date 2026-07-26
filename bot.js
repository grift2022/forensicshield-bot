const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============ CONFIGURACIÓN DE ROLES ============
const OWNER_ROLE_ID = '1200562213195362375';
const ADMIN_ROLE_ID = '1530314208229458102';
const VERIFIED_ROLE_ID = '1530261559429955725'; // Comprado/Verificado
const USER_ROLE_ID = '1530313975361703978';     // User/No verificado

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
const GIVEAWAYS_FILE = path.join(DATA_DIR, 'giveaways.json'); // Sorteos

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

let giveawaysData = {};
if (fs.existsSync(GIVEAWAYS_FILE)) {
    try { giveawaysData = JSON.parse(fs.readFileSync(GIVEAWAYS_FILE)); } catch { giveawaysData = {}; }
}

function saveInvites() { fs.writeFileSync(INVITES_FILE, JSON.stringify(invitesData, null, 2)); }
function saveMembers() { fs.writeFileSync(MEMBERS_FILE, JSON.stringify(membersHistory, null, 2)); }
function saveVerification() { fs.writeFileSync(VERIFICATION_FILE, JSON.stringify(verificationData, null, 2)); }
function saveGiveaways() { fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(giveawaysData, null, 2)); }

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
        const messages = await channel.messages.fetch({ limit: 100 });
        const transcript = messages.reverse().map(m => 
            `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '(Embed o archivo)'}`
        ).join('\n');

        // El nombre del canal puede ser "ticket-<id>" o "reclamado-<id>" (tras reclamarlo),
        // así que extraemos el ID por regex en vez de depender del prefijo "ticket-".
        const userIdMatch = channel.name.match(/\d+/);
        const userMention = userIdMatch ? `<@${userIdMatch[0]}>` : 'Desconocido';

        const embed = new EmbedBuilder()
            .setColor(0xF44336)
            .setTitle('📋 TRANSCRIPCIÓN DE TICKET')
            .addFields(
                { name: '👤 Usuario', value: userMention, inline: true },
                { name: '🔒 Cerrado por', value: closer, inline: true },
                { name: '📅 Fecha', value: new Date().toLocaleString(), inline: true },
                { name: '📝 Mensajes', value: `${messages.size} mensajes` }
            )
            .setTimestamp();

        // Siempre adjuntamos el archivo (antes solo se enviaba si pasaba de 1000 caracteres)
        const buffer = Buffer.from(transcript.length > 0 ? transcript : 'No hubo mensajes en este ticket.', 'utf-8');

        const sentMsg = await transcriptChannel.send({
            embeds: [embed],
            files: [{
                attachment: buffer,
                name: `transcript-${channel.name}.txt`
            }]
        });

        // Añadimos un botón de descarga que apunta directamente al archivo subido
        const attachment = sentMsg.attachments.first();
        if (attachment) {
            const downloadRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('⬇️ Descargar transcripción')
                    .setStyle(ButtonStyle.Link)
                    .setURL(attachment.url)
            );
            await sentMsg.edit({ components: [downloadRow] }).catch(() => {});
        }

    } catch (error) {
        console.error('[!] Error enviando transcript:', error);
    }
}

// ============ SISTEMA DE SORTEOS ============

// Convierte "1d12h", "30m", "45s" etc. en milisegundos. Devuelve null si no es válido.
function parseDuration(str) {
    if (!str) return null;
    const regex = /(\d+)\s*(d|h|m|s)/gi;
    let match;
    let totalMs = 0;
    let matched = false;
    while ((match = regex.exec(str)) !== null) {
        matched = true;
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        if (unit === 'd') totalMs += value * 24 * 60 * 60 * 1000;
        if (unit === 'h') totalMs += value * 60 * 60 * 1000;
        if (unit === 'm') totalMs += value * 60 * 1000;
        if (unit === 's') totalMs += value * 1000;
    }
    return matched && totalMs > 0 ? totalMs : null;
}

function buildGiveawayEmbed(giveaway) {
    const endTimestamp = Math.floor(giveaway.endTime / 1000);
    const embed = new EmbedBuilder()
        .setColor(giveaway.ended ? 0x808080 : 0x9B59B6)
        .setTitle(giveaway.ended ? '🎉 SORTEO FINALIZADO' : '🎉 SORTEO ACTIVO')
        .setDescription(
            `**🎁 Premio:** ${giveaway.prize}\n` +
            (giveaway.description ? `${giveaway.description}\n\n` : '\n') +
            `**🏆 Ganadores:** ${giveaway.winnersCount}\n` +
            `**👥 Participantes:** ${giveaway.participants.length}\n` +
            (giveaway.ended
                ? `**📅 Finalizado:** <t:${endTimestamp}:F>`
                : `**⏱️ Termina:** <t:${endTimestamp}:R> (<t:${endTimestamp}:F>)`)
        )
        .setFooter({ text: `Organizado por ${giveaway.hostTag}` })
        .setTimestamp();

    if (giveaway.ended) {
        embed.addFields({
            name: '🏆 Ganador(es)',
            value: (giveaway.winners && giveaway.winners.length > 0)
                ? giveaway.winners.map(id => `<@${id}>`).join('\n')
                : 'Nadie participó, no hubo ganadores.'
        });
    }

    return embed;
}

function buildGiveawayRow(giveaway) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`giveaway_enter_${giveaway.id}`)
            .setLabel(giveaway.ended ? 'Sorteo finalizado' : `🎉 Participar (${giveaway.participants.length})`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(giveaway.ended)
    );
}

async function endGiveaway(giveawayId) {
    const giveaway = giveawaysData[giveawayId];
    if (!giveaway || giveaway.ended) return;

    giveaway.ended = true;

    const pool = [...giveaway.participants];
    const winners = [];
    const winnersCount = Math.min(giveaway.winnersCount, pool.length);
    for (let i = 0; i < winnersCount; i++) {
        const randIdx = Math.floor(Math.random() * pool.length);
        winners.push(pool.splice(randIdx, 1)[0]);
    }
    giveaway.winners = winners;
    saveGiveaways();

    try {
        const channel = await client.channels.fetch(giveaway.channelId);
        const msg = await channel.messages.fetch(giveaway.messageId);
        await msg.edit({ embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayRow(giveaway)] });

        if (winners.length > 0) {
            await channel.send(`🎉 ¡Felicidades ${winners.map(id => `<@${id}>`).join(', ')}! Has/Habéis ganado **${giveaway.prize}**.`);
        } else {
            await channel.send(`🎉 El sorteo de **${giveaway.prize}** ha finalizado, pero nadie participó.`);
        }

        await sendLog(channel.guild, `🎉 Sorteo finalizado: **${giveaway.prize}** (${winners.length} ganador(es))`, 0x9B59B6);
    } catch (error) {
        console.error('[!] Error finalizando sorteo:', error);
    }
}

function scheduleGiveawayEnd(giveawayId, delayMs) {
    setTimeout(() => {
        endGiveaway(giveawayId).catch(err => console.error('[!] Error en scheduleGiveawayEnd:', err));
    }, Math.max(delayMs, 0));
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

    // Reprogramar sorteos activos que quedaron pendientes de un reinicio
    Object.values(giveawaysData).forEach(giveaway => {
        if (giveaway.ended) return;
        const remaining = giveaway.endTime - Date.now();
        if (remaining <= 0) {
            endGiveaway(giveaway.id).catch(() => {});
        } else {
            scheduleGiveawayEnd(giveaway.id, remaining);
        }
    });
});

// ============ COMANDOS ============
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ===== COMANDO: !verificar =====
    if (command === 'verificar' || command === 'rol') {
        const member = message.member;
        if (!member) return;
        
        const isOwner = member.roles.cache.has(OWNER_ROLE_ID);
        const isAdmin = member.roles.cache.has(ADMIN_ROLE_ID);
        const isVerified = member.roles.cache.has(VERIFIED_ROLE_ID);
        const isUser = member.roles.cache.has(USER_ROLE_ID);
        
        let response = '📋 **Tu información:**\n';
        response += `• Owner: ${isOwner ? '✅ Sí' : '❌ No'}\n`;
        response += `• Admin: ${isAdmin ? '✅ Sí' : '❌ No'}\n`;
        response += `• Verificado: ${isVerified ? '✅ Sí' : '❌ No'}\n`;
        response += `• User: ${isUser ? '✅ Sí' : '❌ No'}`;
        
        message.reply(response);
        await sendLog(message.guild, `📋 ${message.author.tag} usó !verificar`, 0x5865F2);
    }

    // ===== COMANDO: !verificacion (UNA SOLA VEZ) =====
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

    // ===== COMANDO: !ticket =====
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

    // ===== COMANDO: !anti-raid =====
    if (command === 'anti-raid' || command === 'antiraid') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        antiRaidEnabled = !antiRaidEnabled;
        message.channel.send(antiRaidEnabled ? '🛡️ **Anti-Raid ACTIVADO**' : '🛡️ **Anti-Raid DESACTIVADO**');
        await sendLog(message.guild, `🛡️ ${message.author.tag} ${antiRaidEnabled ? 'activó' : 'desactivó'} Anti-Raid`, 0xFF9800);
    }

    // ===== COMANDO: !sorteo (PANEL DE SORTEOS) =====
    if (command === 'sorteo') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            await message.delete().catch(() => {});

            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('🎉 Crear Sorteo')
                .setDescription('Haz clic en el botón para configurar un nuevo sorteo (premio, duración y ganadores).')
                .setFooter({ text: 'Sistema de Sorteos - ForensicShield' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('abrir_sorteo')
                        .setLabel('🎉 Crear Sorteo')
                        .setStyle(ButtonStyle.Primary)
                );

            await message.channel.send({ embeds: [embed], components: [row] });
            await sendLog(message.guild, `🎉 ${message.author.tag} abrió el panel de sorteos`, 0x9B59B6);

        } catch (error) {
            console.error('[!] Error en !sorteo:', error);
            message.reply('❌ Error al crear el panel de sorteos.');
        }
    }

    // ===== COMANDO: !terminarsorteo <ID del mensaje> =====
    if (command === 'terminarsorteo') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        const giveawayId = args[0];
        const giveaway = giveawaysData[giveawayId];

        if (!giveawayId || !giveaway) {
            return message.reply('❌ Uso: `!terminarsorteo <ID del mensaje del sorteo>`');
        }
        if (giveaway.ended) {
            return message.reply('⚠️ Ese sorteo ya había finalizado.');
        }

        await endGiveaway(giveawayId);
        message.reply('✅ Sorteo finalizado manualmente.');
        await sendLog(message.guild, `🛑 ${message.author.tag} finalizó manualmente el sorteo **${giveaway.prize}**`, 0x9B59B6);
    }

    // ===== COMANDO: !rerollsorteo <ID del mensaje> =====
    if (command === 'rerollsorteo') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        const giveawayId = args[0];
        const giveaway = giveawaysData[giveawayId];

        if (!giveawayId || !giveaway || !giveaway.ended) {
            return message.reply('❌ Uso: `!rerollsorteo <ID del mensaje del sorteo>` (el sorteo debe haber finalizado ya).');
        }
        if (!giveaway.participants || giveaway.participants.length === 0) {
            return message.reply('⚠️ No hay participantes para volver a sortear.');
        }

        const randIdx = Math.floor(Math.random() * giveaway.participants.length);
        const newWinner = giveaway.participants[randIdx];
        giveaway.winners = [newWinner];
        saveGiveaways();

        message.channel.send(`🎉 Nuevo ganador del sorteo **${giveaway.prize}**: <@${newWinner}>`);
        await sendLog(message.guild, `🔄 ${message.author.tag} rehizo el sorteo **${giveaway.prize}**`, 0x9B59B6);
    }

    // ===== COMANDO: !anuncio (PANEL INTERACTIVO) =====
    if (command === 'anuncio') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            // Eliminar mensaje del usuario
            await message.delete().catch(() => {});

            // ===== CREAR PANEL (MODAL) =====
            const modal = new ModalBuilder()
                .setCustomId('anuncio_modal')
                .setTitle('📢 Crear Anuncio');

            // Título
            const titleInput = new TextInputBuilder()
                .setCustomId('anuncio_titulo')
                .setLabel('📌 Título (opcional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: Nuevo evento en el servidor')
                .setRequired(false)
                .setMaxLength(100);

            // Descripción
            const descInput = new TextInputBuilder()
                .setCustomId('anuncio_desc')
                .setLabel('📝 Descripción')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Escribe el contenido del anuncio...')
                .setRequired(true)
                .setMaxLength(4000);

            // Imagen URL
            const imgInput = new TextInputBuilder()
                .setCustomId('anuncio_img')
                .setLabel('🖼️ URL de imagen (opcional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://i.imgur.com/ejemplo.png')
                .setRequired(false)
                .setMaxLength(200);

            // Color
            const colorInput = new TextInputBuilder()
                .setCustomId('anuncio_color')
                .setLabel('🎨 Color (#hex)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#e94560')
                .setRequired(false)
                .setMaxLength(7);

            // Footer
            const footerInput = new TextInputBuilder()
                .setCustomId('anuncio_footer')
                .setLabel('📌 Pie de página (opcional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Equipo ForensicShield')
                .setRequired(false)
                .setMaxLength(50);

            // Añadir campos al modal
            const row1 = new ActionRowBuilder().addComponents(titleInput);
            const row2 = new ActionRowBuilder().addComponents(descInput);
            const row3 = new ActionRowBuilder().addComponents(imgInput);
            const row4 = new ActionRowBuilder().addComponents(colorInput);
            const row5 = new ActionRowBuilder().addComponents(footerInput);

            modal.addComponents(row1, row2, row3, row4, row5);

            // Mostrar modal
            await message.author.send({ 
                content: '📢 Abre el panel de anuncios haciendo clic en el botón de abajo:',
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('abrir_anuncio')
                            .setLabel('📢 Crear Anuncio')
                            .setStyle(ButtonStyle.Primary)
                    )
                ]
            });

            // Enviar mensaje en el canal indicando que se ha enviado un DM
            const dmMsg = await message.channel.send(`📢 ${message.author}, revisa tu **mensaje directo** para crear el anuncio.`);
            setTimeout(() => dmMsg.delete().catch(() => {}), 5000);

        } catch (error) {
            console.error('[!] Error en !anuncio:', error);
            message.reply('❌ Error al abrir el panel de anuncios. Asegúrate de tener los DMs abiertos.');
        }
    }
});

// ============ INTERACCIONES ============
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        
        // ===== BOTÓN PARA ABRIR MODAL DE ANUNCIO =====
        if (interaction.customId === 'abrir_anuncio') {
            try {
                const modal = new ModalBuilder()
                    .setCustomId('anuncio_modal')
                    .setTitle('📢 Crear Anuncio');

                const titleInput = new TextInputBuilder()
                    .setCustomId('anuncio_titulo')
                    .setLabel('📌 Título (opcional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ej: Nuevo evento en el servidor')
                    .setRequired(false)
                    .setMaxLength(100);

                const descInput = new TextInputBuilder()
                    .setCustomId('anuncio_desc')
                    .setLabel('📝 Descripción')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Escribe el contenido del anuncio...')
                    .setRequired(true)
                    .setMaxLength(4000);

                const imgInput = new TextInputBuilder()
                    .setCustomId('anuncio_img')
                    .setLabel('🖼️ URL de imagen (opcional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('https://i.imgur.com/ejemplo.png')
                    .setRequired(false)
                    .setMaxLength(200);

                const colorInput = new TextInputBuilder()
                    .setCustomId('anuncio_color')
                    .setLabel('🎨 Color (#hex)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('#e94560')
                    .setRequired(false)
                    .setMaxLength(7);

                const footerInput = new TextInputBuilder()
                    .setCustomId('anuncio_footer')
                    .setLabel('📌 Pie de página (opcional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Equipo ForensicShield')
                    .setRequired(false)
                    .setMaxLength(50);

                const row1 = new ActionRowBuilder().addComponents(titleInput);
                const row2 = new ActionRowBuilder().addComponents(descInput);
                const row3 = new ActionRowBuilder().addComponents(imgInput);
                const row4 = new ActionRowBuilder().addComponents(colorInput);
                const row5 = new ActionRowBuilder().addComponents(footerInput);

                modal.addComponents(row1, row2, row3, row4, row5);

                await interaction.showModal(modal);

            } catch (error) {
                console.error('[!] Error abriendo modal:', error);
                await interaction.reply({
                    content: '❌ Error al abrir el panel.',
                    ephemeral: true
                });
            }
        }

        // ===== BOTÓN PARA ABRIR MODAL DE SORTEO =====
        if (interaction.customId === 'abrir_sorteo') {
            if (!hasPermission(interaction.member)) {
                return interaction.reply({
                    content: '❌ No tienes permiso para crear sorteos.',
                    ephemeral: true
                });
            }

            try {
                const modal = new ModalBuilder()
                    .setCustomId('sorteo_modal')
                    .setTitle('🎉 Crear Sorteo');

                const premioInput = new TextInputBuilder()
                    .setCustomId('sorteo_premio')
                    .setLabel('🎁 Premio')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ej: Nitro Classic x1')
                    .setRequired(true)
                    .setMaxLength(200);

                const duracionInput = new TextInputBuilder()
                    .setCustomId('sorteo_duracion')
                    .setLabel('⏱️ Duración (ej: 1d12h, 30m, 45s)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('1h')
                    .setRequired(true)
                    .setMaxLength(20);

                const ganadoresInput = new TextInputBuilder()
                    .setCustomId('sorteo_ganadores')
                    .setLabel('🏆 Número de ganadores')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('1')
                    .setRequired(true)
                    .setMaxLength(3);

                const descInput = new TextInputBuilder()
                    .setCustomId('sorteo_desc')
                    .setLabel('📝 Requisitos/Descripción (opcional)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Ej: Debes estar en el servidor y tener el rol Verificado')
                    .setRequired(false)
                    .setMaxLength(500);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(premioInput),
                    new ActionRowBuilder().addComponents(duracionInput),
                    new ActionRowBuilder().addComponents(ganadoresInput),
                    new ActionRowBuilder().addComponents(descInput)
                );

                await interaction.showModal(modal);

            } catch (error) {
                console.error('[!] Error abriendo modal de sorteo:', error);
                await interaction.reply({
                    content: '❌ Error al abrir el panel de sorteo.',
                    ephemeral: true
                });
            }
        }

        // ===== PARTICIPAR EN SORTEO =====
        if (interaction.customId.startsWith('giveaway_enter_')) {
            try {
                const giveawayId = interaction.customId.replace('giveaway_enter_', '');
                const giveaway = giveawaysData[giveawayId];

                if (!giveaway || giveaway.ended) {
                    return interaction.reply({
                        content: '⚠️ Este sorteo ya ha finalizado.',
                        ephemeral: true
                    });
                }

                const userId = interaction.user.id;
                const idx = giveaway.participants.indexOf(userId);

                if (idx === -1) {
                    giveaway.participants.push(userId);
                    saveGiveaways();
                    await interaction.reply({ content: '✅ ¡Ahora estás participando en el sorteo!', ephemeral: true });
                } else {
                    giveaway.participants.splice(idx, 1);
                    saveGiveaways();
                    await interaction.reply({ content: '↩️ Has salido del sorteo.', ephemeral: true });
                }

                const channel = await client.channels.fetch(giveaway.channelId);
                const msg = await channel.messages.fetch(giveaway.messageId);
                await msg.edit({ embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayRow(giveaway)] });

            } catch (error) {
                console.error('[!] Error al participar en sorteo:', error);
                await interaction.reply({
                    content: '❌ Error al procesar tu participación.',
                    ephemeral: true
                }).catch(() => {});
            }
        }

        // ===== VERIFICACIÓN =====
        if (interaction.customId === 'verify_member' || interaction.customId === 'rules_accept') {
            try {
                const verifiedRole = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
                const userRole = interaction.guild.roles.cache.get(USER_ROLE_ID);
                
                if (verifiedRole) {
                    if (userRole) {
                        await interaction.member.roles.remove(userRole).catch(() => {});
                    }
                    await interaction.member.roles.add(verifiedRole);
                    await interaction.reply({
                        content: '✅ ¡Te has verificado correctamente!',
                        ephemeral: true
                    });
                    await sendLog(interaction.guild, `✅ ${interaction.user.tag} se ha verificado (User → Verified)`, 0x4CAF50);
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
                await sendLog(interaction.guild, `🎫 ${interaction.user.tag} abrió un ticket`, 0x5865F2);

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

                const newName = `reclamado-${interaction.channel.name.replace('ticket-', '')}`;
                await interaction.channel.setName(newName).catch(() => {});

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
    }

    // ===== MODAL DE SORTEO =====
    if (interaction.isModalSubmit() && interaction.customId === 'sorteo_modal') {
        try {
            const prize = interaction.fields.getTextInputValue('sorteo_premio');
            const durationStr = interaction.fields.getTextInputValue('sorteo_duracion');
            const winnersStr = interaction.fields.getTextInputValue('sorteo_ganadores');
            const description = interaction.fields.getTextInputValue('sorteo_desc') || '';

            const durationMs = parseDuration(durationStr);
            if (!durationMs) {
                return interaction.reply({
                    content: '❌ Duración inválida. Usa un formato como `1d`, `12h`, `30m`, `45s` (se pueden combinar, ej: `1d12h`).',
                    ephemeral: true
                });
            }

            const winnersCount = parseInt(winnersStr, 10);
            if (!winnersCount || winnersCount < 1) {
                return interaction.reply({
                    content: '❌ El número de ganadores debe ser un número entero mayor a 0.',
                    ephemeral: true
                });
            }

            await interaction.reply({ content: '✅ Sorteo creado correctamente.', ephemeral: true });

            const endTime = Date.now() + durationMs;

            // Enviamos primero un mensaje placeholder para obtener su ID (se usará como ID del sorteo)
            const placeholderEmbed = new EmbedBuilder().setColor(0x9B59B6).setDescription('🎉 Preparando sorteo...');
            const sentMsg = await interaction.channel.send({ embeds: [placeholderEmbed] });

            const giveaway = {
                id: sentMsg.id,
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                messageId: sentMsg.id,
                prize,
                description,
                winnersCount,
                endTime,
                hostId: interaction.user.id,
                hostTag: interaction.user.tag,
                participants: [],
                ended: false
            };

            giveawaysData[giveaway.id] = giveaway;
            saveGiveaways();

            await sentMsg.edit({ embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayRow(giveaway)] });

            scheduleGiveawayEnd(giveaway.id, durationMs);

            await sendLog(interaction.guild, `🎉 ${interaction.user.tag} creó un sorteo: **${prize}** (ID: ${giveaway.id})`, 0x9B59B6);

        } catch (error) {
            console.error('[!] Error en modal de sorteo:', error);
            await interaction.reply({
                content: '❌ Error al crear el sorteo.',
                ephemeral: true
            }).catch(() => {});
        }
    }

    // ===== MODAL DE ANUNCIO =====
    if (interaction.isModalSubmit() && interaction.customId === 'anuncio_modal') {
        try {
            // Obtener valores del modal
            const title = interaction.fields.getTextInputValue('anuncio_titulo') || '';
            const description = interaction.fields.getTextInputValue('anuncio_desc');
            const imageUrl = interaction.fields.getTextInputValue('anuncio_img') || '';
            const color = interaction.fields.getTextInputValue('anuncio_color') || '#e94560';
            const footer = interaction.fields.getTextInputValue('anuncio_footer') || '';

            // Validar que haya descripción
            if (!description || description.trim() === '') {
                return interaction.reply({
                    content: '❌ Debes escribir una descripción para el anuncio.',
                    ephemeral: true
                });
            }

            // Validar color
            const colorRegex = /^#[0-9a-fA-F]{6}$/;
            const finalColor = colorRegex.test(color) ? color : '#e94560';

            // ===== CONSTRUIR ANUNCIO =====
            const embed = new EmbedBuilder()
                .setColor(finalColor)
                .setTimestamp();

            if (title) embed.setTitle(title);
            embed.setDescription(description);

            // Autor (quien envió el anuncio)
            embed.setAuthor({
                name: interaction.user.username,
                iconURL: interaction.user.displayAvatarURL()
            });

            // Imagen
            if (imageUrl && imageUrl.trim() !== '') {
                try {
                    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                        embed.setImage(imageUrl);
                    }
                } catch (e) { /* ignorar */ }
            }

            // Footer
            if (footer) {
                embed.setFooter({ text: footer });
            }

            // ===== ENVIAR ANUNCIO =====
            await interaction.channel.send({ embeds: [embed] });

            // Respuesta al usuario
            await interaction.reply({
                content: '✅ Anuncio enviado correctamente.',
                ephemeral: true
            });

            // Log
            await sendLog(interaction.guild, `📢 ${interaction.user.tag} envió un anuncio`, 0xFF9800);

        } catch (error) {
            console.error('[!] Error en modal de anuncio:', error);
            await interaction.reply({
                content: '❌ Error al enviar el anuncio. Verifica que la URL de la imagen sea válida.',
                ephemeral: true
            });
        }
    }
});

// ============ EVENTOS DE ENTRADA Y SALIDA ============
client.on(Events.GuildMemberAdd, async (member) => {
    console.log(`[LOG] ${member.user.tag} entró al servidor`);

    // ===== ASIGNAR ROL USER (1530313975361703978) AL ENTRAR =====
    try {
        const userRole = member.guild.roles.cache.get(USER_ROLE_ID);
        if (userRole) {
            await member.roles.add(userRole);
            console.log(`[✅] Rol User (${USER_ROLE_ID}) asignado a ${member.user.tag}`);
            await sendLog(member.guild, `👤 ${member.user.tag} recibió el rol User`, 0x4CAF50);
        } else {
            console.log(`[!] Rol User (${USER_ROLE_ID}) no encontrado`);
        }
    } catch (error) {
        console.error(`[!] Error asignando rol User a ${member.user.tag}:`, error);
    }

    // ===== ANTI-RAID =====
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

    // ===== REGISTRAR INVITACIÓN =====
    try {
        const invites = await member.guild.invites.fetch();
        const cachedInvites = invitesData[member.guild.id] || {};
        let inviterName = 'Desconocido';
        let found = false;

        for (const [code, invite] of invites) {
            if (cachedInvites[code] !== undefined && invite.uses > cachedInvites[code]) {
                inviterName = invite.inviter ? invite.inviter.tag : 'Desconocido';
                found = true;
                
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

        for (const [code, invite] of invites) {
            cachedInvites[code] = invite.uses;
        }
        invitesData[member.guild.id] = cachedInvites;
        saveInvites();

        const totalInvites = membersHistory[member.guild.id]?.invites?.[inviterName] || 0;

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

        await sendLog(member.guild, `🟢 ${member.user.tag} entró (Invitado por: ${inviterName} - ${totalInvites} invitaciones)`, 0x4CAF50);

    } catch (error) {
        console.error('[!] Error registrando entrada:', error);
        const joinChannel = member.guild.channels.cache.get(JOIN_CHANNEL_ID);
        if (joinChannel) {
            joinChannel.send(`🟢 **${member.user.tag}** ha entrado al servidor.`);
        }
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    console.log(`[LOG] ${member.user.tag} salió del servidor`);
    
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