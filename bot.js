const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============ CONFIGURACIÓN DE ROLES ============
const OWNER_ROLE_ID = '1200562213195362375';
const ADMIN_ROLE_ID = '1530314208229458102';
const VERIFIED_ROLE_ID = '1530261559429955725';
const USER_ROLE_ID = '1530313975361703978';

// ============ CANALES ============
const LOG_CHANNEL_ID = '1530329506445918400';
const JOIN_CHANNEL_ID = '1530329911741649018';
const TICKET_TRANSCRIPT_CHANNEL_ID = '1530516098749956167';
const ANNOUNCE_CHANNEL_ID = '1521135511052353556'; // <-- CAMBIA ESTO

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 10000;

// ============ ARCHIVOS DE DATOS ============
const DATA_DIR = path.join(__dirname, 'data');
const INVITES_FILE = path.join(DATA_DIR, 'invites.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const VERIFICATION_FILE = path.join(DATA_DIR, 'verification.json');
const GIVEAWAYS_FILE = path.join(DATA_DIR, 'giveaways.json');

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

// ============ FUNCIÓN PARA OBTENER EL CANAL DE ANUNCIOS ============
function getAnnounceChannel(guild) {
    let channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
    if (!channel) {
        channel = guild.channels.cache.find(
            ch => ch.name === 'anuncios' || 
                  ch.name === 'anuncios-generales' || 
                  ch.name === '📢-anuncios' ||
                  ch.name === 'anuncios-oficiales' ||
                  ch.name === 'comunicados'
        );
    }
    return channel;
}

// ============ FUNCIÓN PARA SELECCIONAR GANADORES ============
function selectWinners(participants, winnersCount) {
    const shuffled = [...participants];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, winnersCount);
}

// ============ FUNCIÓN PARA FINALIZAR SORTEO ============
async function finalizeGiveaway(interaction, giveawayId) {
    try {
        const giveaway = giveawaysData[interaction.guildId]?.[giveawayId];
        if (!giveaway) {
            return interaction.reply({
                content: '❌ No se encontró el sorteo.',
                ephemeral: true
            });
        }

        if (giveaway.ended) {
            return interaction.reply({
                content: '⚠️ Este sorteo ya ha finalizado.',
                ephemeral: true
            });
        }

        const participants = giveaway.participants || [];
        
        if (participants.length === 0) {
            giveaway.ended = true;
            saveGiveaways();
            
            await interaction.reply({
                content: '❌ No hay participantes en este sorteo.',
                ephemeral: true
            });

            const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setColor(0xF44336)
                    .setTitle('❌ SORTEO CANCELADO')
                    .setDescription(`**${giveaway.title}**\n\nNo hubo participantes.`)
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
            return;
        }

        const winners = selectWinners(participants, giveaway.winnersCount);
        giveaway.ended = true;
        giveaway.winners = winners;
        saveGiveaways();

        const winnersMentions = winners.map(id => `<@${id}>`).join(' ');

        const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0x4CAF50)
                .setTitle('🎉 SORTEO FINALIZADO')
                .setDescription(`**${giveaway.title}**\n\n**Ganadores (${winners.length}):**\n${winnersMentions}\n\n¡Felicidades a los ganadores!`)
                .setTimestamp();

            await channel.send({
                content: `🎉 **GANADORES DEL SORTEO** 🎉\n${winnersMentions}`,
                embeds: [embed]
            });
        }

        await interaction.reply({
            content: `✅ Sorteo finalizado. Ganadores: ${winnersMentions}`,
            ephemeral: true
        });

        await sendLog(interaction.guild, `🎉 Sorteo "${giveaway.title}" finalizado. Ganadores: ${winners.length}`, 0x4CAF50);

    } catch (error) {
        console.error('[!] Error finalizando sorteo:', error);
        await interaction.reply({
            content: '❌ Error al finalizar el sorteo.',
            ephemeral: true
        });
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
    console.log(`[✅] Announce Channel: ${ANNOUNCE_CHANNEL_ID}`);
    
    client.guilds.cache.forEach(guild => {
        console.log(`[📁] Servidor: ${guild.name} (ID: ${guild.id})`);
        if (!invitesData[guild.id]) {
            invitesData[guild.id] = {};
        }
        if (!verificationData[guild.id]) {
            verificationData[guild.id] = { sent: false };
        }
        if (!giveawaysData[guild.id]) {
            giveawaysData[guild.id] = {};
        }
        saveInvites();
        saveVerification();
        saveGiveaways();
        
        const announceChannel = getAnnounceChannel(guild);
        if (announceChannel) {
            console.log(`[✅] Canal de anuncios encontrado: #${announceChannel.name}`);
        } else {
            console.log(`[⚠️] No se encontró canal de anuncios en ${guild.name}`);
        }
        
        sendLog(guild, '🟢 **Bot iniciado y listo para funcionar**', 0x4CAF50);
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

    // ===== COMANDO: !verificacion =====
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

    // ===== COMANDO: !anuncio =====
    if (command === 'anuncio') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            await message.delete().catch(() => {});

            const announceChannel = getAnnounceChannel(message.guild);
            if (!announceChannel) {
                await message.channel.send('⚠️ **No se encontró un canal de anuncios.**\nCrea un canal llamado `anuncios` o configura el ID en el bot.');
                return;
            }

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

            if (!global.announceTargets) global.announceTargets = new Map();
            global.announceTargets.set(message.author.id, announceChannel.id);

            await message.author.send({
                content: `📢 **Panel de Anuncios**\nEl anuncio se publicará en: <#${announceChannel.id}>\n\nHaz clic en el botón para crear tu anuncio:`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('abrir_anuncio')
                            .setLabel('📢 Crear Anuncio')
                            .setStyle(ButtonStyle.Primary)
                    )
                ]
            });

            const msg = await message.channel.send({
                content: `📢 ${message.author}, revisa tu **mensaje directo** para crear el anuncio. Se publicará en <#${announceChannel.id}>.`
            });
            setTimeout(() => msg.delete().catch(() => {}), 8000);

            await sendLog(message.guild, `📢 ${message.author.tag} abrió el panel de anuncios (Canal: ${announceChannel.name})`, 0x5865F2);

        } catch (error) {
            console.error('[!] Error en !anuncio:', error);
            if (error.code === 50007) {
                message.reply('❌ No puedo enviarte un mensaje directo. Abre tus DMs y vuelve a intentarlo.');
            } else {
                message.reply('❌ Error al abrir el panel de anuncios.');
            }
        }
    }

    // ===== COMANDO: !sorteo =====
    if (command === 'sorteo') {
        if (!hasPermission(message.member)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            await message.delete().catch(() => {});

            const announceChannel = getAnnounceChannel(message.guild);
            if (!announceChannel) {
                await message.channel.send('⚠️ **No se encontró un canal de anuncios.**\nCrea un canal llamado `anuncios` o configura el ID en el bot.');
                return;
            }

            // ===== CREAR MODAL PARA SORTEO =====
            const modal = new ModalBuilder()
                .setCustomId('sorteo_modal')
                .setTitle('🎉 Crear Sorteo');

            // Título del sorteo
            const titleInput = new TextInputBuilder()
                .setCustomId('sorteo_titulo')
                .setLabel('📌 Título del Sorteo')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: Sorteo de un game pass')
                .setRequired(true)
                .setMaxLength(100);

            // Descripción
            const descInput = new TextInputBuilder()
                .setCustomId('sorteo_desc')
                .setLabel('📝 Descripción / Premio')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Describe el premio y las condiciones...')
                .setRequired(true)
                .setMaxLength(4000);

            // Número de ganadores
            const winnersInput = new TextInputBuilder()
                .setCustomId('sorteo_ganadores')
                .setLabel('👥 Número de ganadores')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: 1, 2, 3...')
                .setRequired(true)
                .setMaxLength(3);

            // Duración (horas)
            const durationInput = new TextInputBuilder()
                .setCustomId('sorteo_duracion')
                .setLabel('⏱️ Duración (horas)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: 24, 48, 72...')
                .setRequired(true)
                .setMaxLength(3);

            // Color
            const colorInput = new TextInputBuilder()
                .setCustomId('sorteo_color')
                .setLabel('🎨 Color (#hex)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#e94560')
                .setRequired(false)
                .setMaxLength(7);

            // Imagen
            const imgInput = new TextInputBuilder()
                .setCustomId('sorteo_img')
                .setLabel('🖼️ URL de imagen (opcional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://i.imgur.com/ejemplo.png')
                .setRequired(false)
                .setMaxLength(200);

            const row1 = new ActionRowBuilder().addComponents(titleInput);
            const row2 = new ActionRowBuilder().addComponents(descInput);
            const row3 = new ActionRowBuilder().addComponents(winnersInput);
            const row4 = new ActionRowBuilder().addComponents(durationInput);
            const row5 = new ActionRowBuilder().addComponents(colorInput);
            const row6 = new ActionRowBuilder().addComponents(imgInput);

            modal.addComponents(row1, row2, row3, row4, row5, row6);

            // Guardar el canal de destino
            if (!global.sorteoTargets) global.sorteoTargets = new Map();
            global.sorteoTargets.set(message.author.id, announceChannel.id);

            // Enviar DM con el botón para abrir el modal
            await message.author.send({
                content: `🎉 **Panel de Sorteo**\nEl sorteo se publicará en: <#${announceChannel.id}>\n\nHaz clic en el botón para crear el sorteo:`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('abrir_sorteo')
                            .setLabel('🎉 Crear Sorteo')
                            .setStyle(ButtonStyle.Success)
                    )
                ]
            });

            const msg = await message.channel.send({
                content: `🎉 ${message.author}, revisa tu **mensaje directo** para crear el sorteo. Se publicará en <#${announceChannel.id}>.`
            });
            setTimeout(() => msg.delete().catch(() => {}), 8000);

            await sendLog(message.guild, `🎉 ${message.author.tag} abrió el panel de sorteo (Canal: ${announceChannel.name})`, 0x5865F2);

        } catch (error) {
            console.error('[!] Error en !sorteo:', error);
            if (error.code === 50007) {
                message.reply('❌ No puedo enviarte un mensaje directo. Abre tus DMs y vuelve a intentarlo.');
            } else {
                message.reply('❌ Error al abrir el panel de sorteo.');
            }
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
                }).catch(() => {});
            }
        }

        // ===== BOTÓN PARA ABRIR MODAL DE SORTEO =====
        if (interaction.customId === 'abrir_sorteo') {
            try {
                const modal = new ModalBuilder()
                    .setCustomId('sorteo_modal')
                    .setTitle('🎉 Crear Sorteo');

                const titleInput = new TextInputBuilder()
                    .setCustomId('sorteo_titulo')
                    .setLabel('📌 Título del Sorteo')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ej: Sorteo de un game pass')
                    .setRequired(true)
                    .setMaxLength(100);

                const descInput = new TextInputBuilder()
                    .setCustomId('sorteo_desc')
                    .setLabel('📝 Descripción / Premio')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Describe el premio y las condiciones...')
                    .setRequired(true)
                    .setMaxLength(4000);

                const winnersInput = new TextInputBuilder()
                    .setCustomId('sorteo_ganadores')
                    .setLabel('👥 Número de ganadores')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ej: 1, 2, 3...')
                    .setRequired(true)
                    .setMaxLength(3);

                const durationInput = new TextInputBuilder()
                    .setCustomId('sorteo_duracion')
                    .setLabel('⏱️ Duración (horas)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ej: 24, 48, 72...')
                    .setRequired(true)
                    .setMaxLength(3);

                const colorInput = new TextInputBuilder()
                    .setCustomId('sorteo_color')
                    .setLabel('🎨 Color (#hex)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('#e94560')
                    .setRequired(false)
                    .setMaxLength(7);

                const imgInput = new TextInputBuilder()
                    .setCustomId('sorteo_img')
                    .setLabel('🖼️ URL de imagen (opcional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('https://i.imgur.com/ejemplo.png')
                    .setRequired(false)
                    .setMaxLength(200);

                const row1 = new ActionRowBuilder().addComponents(titleInput);
                const row2 = new ActionRowBuilder().addComponents(descInput);
                const row3 = new ActionRowBuilder().addComponents(winnersInput);
                const row4 = new ActionRowBuilder().addComponents(durationInput);
                const row5 = new ActionRowBuilder().addComponents(colorInput);
                const row6 = new ActionRowBuilder().addComponents(imgInput);

                modal.addComponents(row1, row2, row3, row4, row5, row6);

                await interaction.showModal(modal);

            } catch (error) {
                console.error('[!] Error abriendo modal de sorteo:', error);
                await interaction.reply({
                    content: '❌ Error al abrir el panel de sorteo.',
                    ephemeral: true
                }).catch(() => {});
            }
        }

        // ===== BOTÓN PARA PARTICIPAR EN SORTEO =====
        if (interaction.customId.startsWith('participar_')) {
            try {
                const giveawayId = interaction.customId.replace('participar_', '');
                const giveaway = giveawaysData[interaction.guildId]?.[giveawayId];

                if (!giveaway) {
                    return interaction.reply({
                        content: '❌ Este sorteo ya no existe o ha finalizado.',
                        ephemeral: true
                    });
                }

                if (giveaway.ended) {
                    return interaction.reply({
                        content: '⚠️ Este sorteo ya ha finalizado.',
                        ephemeral: true
                    });
                }

                if (giveaway.participants && giveaway.participants.includes(interaction.user.id)) {
                    return interaction.reply({
                        content: '⚠️ Ya estás participando en este sorteo.',
                        ephemeral: true
                    });
                }

                if (!giveaway.participants) giveaway.participants = [];
                giveaway.participants.push(interaction.user.id);
                saveGiveaways();

                await interaction.reply({
                    content: `✅ ¡Has participado en **${giveaway.title}**! Mucha suerte 🍀`,
                    ephemeral: true
                });

                // Actualizar el contador de participantes en el mensaje
                const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
                if (channel) {
                    try {
                        const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
                        if (message && message.embeds.length > 0) {
                            const embed = message.embeds[0];
                            const endTime = new Date(giveaway.endTime);
                            const remaining = Math.floor((endTime.getTime() - Date.now()) / 1000);
                            const hours = Math.floor(remaining / 3600);
                            const minutes = Math.floor((remaining % 3600) / 60);
                            
                            const newEmbed = EmbedBuilder.from(embed)
                                .setFooter({ text: `👥 ${giveaway.participants.length} participantes • ⏱️ ${hours}h ${minutes}m restantes` });
                            await message.edit({ embeds: [newEmbed] });
                        }
                    } catch (e) { /* ignorar */ }
                }

            } catch (error) {
                console.error('[!] Error participando en sorteo:', error);
                await interaction.reply({
                    content: '❌ Error al participar en el sorteo.',
                    ephemeral: true
                });
            }
        }

        // ===== BOTÓN PARA FINALIZAR SORTEO =====
        if (interaction.customId.startsWith('finalizar_')) {
            try {
                const hasRole = interaction.member.roles.cache.has(OWNER_ROLE_ID) || 
                                interaction.member.roles.cache.has(ADMIN_ROLE_ID);

                if (!hasRole) {
                    return interaction.reply({
                        content: '❌ Solo administradores pueden finalizar sorteos.',
                        ephemeral: true
                    });
                }

                const giveawayId = interaction.customId.replace('finalizar_', '');
                await finalizeGiveaway(interaction, giveawayId);

            } catch (error) {
                console.error('[!] Error finalizando sorteo:', error);
                await interaction.reply({
                    content: '❌ Error al finalizar el sorteo.',
                    ephemeral: true
                });
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

    // ===== MODAL DE ANUNCIO =====
    if (interaction.isModalSubmit() && interaction.customId === 'anuncio_modal') {
        try {
            const title = interaction.fields.getTextInputValue('anuncio_titulo') || '';
            const description = interaction.fields.getTextInputValue('anuncio_desc');
            const imageUrl = interaction.fields.getTextInputValue('anuncio_img') || '';
            const color = interaction.fields.getTextInputValue('anuncio_color') || '#e94560';
            const footer = interaction.fields.getTextInputValue('anuncio_footer') || '';

            if (!description || description.trim() === '') {
                return interaction.reply({
                    content: '❌ Debes escribir una descripción para el anuncio.',
                    ephemeral: true
                });
            }

            const colorRegex = /^#[0-9a-fA-F]{6}$/;
            const finalColor = colorRegex.test(color) ? color : '#e94560';

            const embed = new EmbedBuilder()
                .setColor(finalColor)
                .setTimestamp();

            if (title) embed.setTitle(title);
            embed.setDescription(description);

            embed.setAuthor({
                name: interaction.user.username,
                iconURL: interaction.user.displayAvatarURL()
            });

            if (imageUrl && imageUrl.trim() !== '') {
                try {
                    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                        embed.setImage(imageUrl);
                    }
                } catch (e) { /* ignorar */ }
            }

            if (footer) {
                embed.setFooter({ text: footer });
            }

            let announceChannel = null;
            
            if (global.announceTargets && global.announceTargets.has(interaction.user.id)) {
                const channelId = global.announceTargets.get(interaction.user.id);
                announceChannel = interaction.guild.channels.cache.get(channelId);
                global.announceTargets.delete(interaction.user.id);
            }
            
            if (!announceChannel) {
                announceChannel = getAnnounceChannel(interaction.guild);
            }

            if (!announceChannel) {
                announceChannel = interaction.channel;
            }

            await announceChannel.send({ 
                content: `@everyone 📢 **NUEVO ANUNCIO**`, 
                embeds: [embed] 
            });

            await interaction.reply({
                content: `✅ Anuncio enviado correctamente a <#${announceChannel.id}>`,
                ephemeral: true
            });

            await sendLog(interaction.guild, `📢 ${interaction.user.tag} envió un anuncio a <#${announceChannel.id}>`, 0xFF9800);

        } catch (error) {
            console.error('[!] Error en modal de anuncio:', error);
            await interaction.reply({
                content: '❌ Error al enviar el anuncio. Verifica que la URL de la imagen sea válida.',
                ephemeral: true
            }).catch(() => {});
        }
    }

    // ===== MODAL DE SORTEO =====
    if (interaction.isModalSubmit() && interaction.customId === 'sorteo_modal') {
        try {
            // Obtener valores del modal
            const title = interaction.fields.getTextInputValue('sorteo_titulo');
            const description = interaction.fields.getTextInputValue('sorteo_desc');
            const winnersCount = parseInt(interaction.fields.getTextInputValue('sorteo_ganadores')) || 1;
            const durationHours = parseInt(interaction.fields.getTextInputValue('sorteo_duracion')) || 24;
            const color = interaction.fields.getTextInputValue('sorteo_color') || '#e94560';
            const imageUrl = interaction.fields.getTextInputValue('sorteo_img') || '';

            // Validaciones
            if (!title || title.trim() === '') {
                return interaction.reply({
                    content: '❌ Debes escribir un título para el sorteo.',
                    ephemeral: true
                });
            }

            if (!description || description.trim() === '') {
                return interaction.reply({
                    content: '❌ Debes escribir una descripción para el sorteo.',
                    ephemeral: true
                });
            }

            if (winnersCount < 1 || winnersCount > 10) {
                return interaction.reply({
                    content: '❌ El número de ganadores debe ser entre 1 y 10.',
                    ephemeral: true
                });
            }

            if (durationHours < 1 || durationHours > 168) {
                return interaction.reply({
                    content: '❌ La duración debe ser entre 1 y 168 horas (7 días).',
                    ephemeral: true
                });
            }

            const colorRegex = /^#[0-9a-fA-F]{6}$/;
            const finalColor = colorRegex.test(color) ? color : '#e94560';

            // Buscar canal de anuncios
            let announceChannel = null;
            
            if (global.sorteoTargets && global.sorteoTargets.has(interaction.user.id)) {
                const channelId = global.sorteoTargets.get(interaction.user.id);
                announceChannel = interaction.guild.channels.cache.get(channelId);
                global.sorteoTargets.delete(interaction.user.id);
            }
            
            if (!announceChannel) {
                announceChannel = getAnnounceChannel(interaction.guild);
            }

            if (!announceChannel) {
                announceChannel = interaction.channel;
            }

            // Generar ID único para el sorteo
            const giveawayId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

            // Calcular tiempo de finalización
            const endTime = new Date(Date.now() + durationHours * 60 * 60 * 1000);
            const endTimestamp = Math.floor(endTime.getTime() / 1000);

            // Calcular tiempo restante para mostrar
            const hours = Math.floor(durationHours);
            const minutes = Math.floor((durationHours % 1) * 60);

            // Crear embed del sorteo
            const embed = new EmbedBuilder()
                .setColor(finalColor)
                .setTitle('🎉 ' + title)
                .setDescription(description)
                .addFields(
                    { name: '👥 Ganadores', value: `${winnersCount}`, inline: true },
                    { name: '⏱️ Finaliza', value: `<t:${endTimestamp}:R>`, inline: true },
                    { name: '👤 Creado por', value: interaction.user.username, inline: true }
                )
                .setTimestamp();

            if (imageUrl && imageUrl.trim() !== '') {
                try {
                    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                        embed.setImage(imageUrl);
                    }
                } catch (e) { /* ignorar */ }
            }

            embed.setFooter({ text: `👥 0 participantes • ⏱️ ${hours}h ${minutes}m restantes` });

            // Botones
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`participar_${giveawayId}`)
                        .setLabel('🎯 Participar')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`finalizar_${giveawayId}`)
                        .setLabel('🏆 Finalizar Sorteo')
                        .setStyle(ButtonStyle.Danger)
                );

            // Enviar mensaje del sorteo
            const message = await announceChannel.send({
                content: `🎉 **NUEVO SORTEO** 🎉\nParticipa haciendo clic en el botón de abajo.`,
                embeds: [embed],
                components: [row]
            });

            // Guardar datos del sorteo
            if (!giveawaysData[interaction.guildId]) {
                giveawaysData[interaction.guildId] = {};
            }

            giveawaysData[interaction.guildId][giveawayId] = {
                title: title,
                description: description,
                winnersCount: winnersCount,
                durationHours: durationHours,
                endTime: endTime.toISOString(),
                channelId: announceChannel.id,
                messageId: message.id,
                participants: [],
                ended: false,
                createdBy: interaction.user.id,
                createdAt: new Date().toISOString()
            };
            saveGiveaways();

            // Programar finalización automática
            setTimeout(async () => {
                try {
                    const giveaway = giveawaysData[interaction.guildId]?.[giveawayId];
                    if (giveaway && !giveaway.ended) {
                        const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
                        if (channel) {
                            const msg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
                            if (msg) {
                                // Crear una interacción falsa para finalizar
                                const fakeInteraction = {
                                    guildId: interaction.guildId,
                                    guild: interaction.guild,
                                    reply: async (data) => {
                                        console.log('[✅] Sorteo finalizado automáticamente:', data.content);
                                    }
                                };
                                await finalizeGiveaway(fakeInteraction, giveawayId);
                            }
                        }
                    }
                } catch (e) { 
                    console.error('[!] Error en finalización automática:', e);
                }
            }, durationHours * 60 * 60 * 1000);

            // Respuesta al usuario
            await interaction.reply({
                content: `✅ **Sorteo creado correctamente!**\n📌 Título: ${title}\n👥 Ganadores: ${winnersCount}\n⏱️ Finaliza: <t:${endTimestamp}:R>\n📢 Publicado en: <#${announceChannel.id}>`,
                ephemeral: true
            });

            await sendLog(interaction.guild, `🎉 ${interaction.user.tag} creó un sorteo: "${title}" (${winnersCount} ganadores, ${durationHours}h)`, 0x4CAF50);

        } catch (error) {
            console.error('[!] Error en modal de sorteo:', error);
            await interaction.reply({
                content: '❌ Error al crear el sorteo. Verifica que todos los campos sean válidos.',
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ============ EVENTOS DE ENTRADA Y SALIDA ============
client.on(Events.GuildMemberAdd, async (member) => {
    console.log(`[LOG] ${member.user.tag} entró al servidor`);

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

    try {
        const invites = await member.guild.invites.fetch();
        const cachedInvites = invitesData[member.guild.id] || {};
        let inviterName = 'Desconocido';

        for (const [code, invite] of invites) {
            if (cachedInvites[code] !== undefined && invite.uses > cachedInvites[code]) {
                inviterName = invite.inviter ? invite.inviter.tag : 'Desconocido';
                
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
