const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const express = require('express');

// ============ CONFIGURACIÓN ============
const TOKEN = process.env.DISCORD_TOKEN;
const ROLE_ID = process.env.ROLE_ID || '1530261559429955725';
const PORT = process.env.PORT || 10000;

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
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

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

    // ===== COMANDO: !anuncio =====
    if (command === 'anuncio') {
        // Verificar que el usuario tiene el rol permitido
        if (!message.member.roles.cache.has(ROLE_ID)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        const text = args.join(' ');
        if (!text) {
            return message.reply('❌ Uso correcto: `!anuncio <mensaje>`');
        }

        try {
            // Eliminar el mensaje del usuario (opcional, para mantener limpio el canal)
            await message.delete().catch(() => {});

            // Crear embed de anuncio
            const embed = new EmbedBuilder()
                .setColor(0xe94560)
                .setTitle('📢 ANUNCIO OFICIAL')
                .setDescription(text)
                .setFooter({ text: `Anunciado por ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
                .setTimestamp();

            // Enviar el anuncio con mención @everyone
            await message.channel.send({
                content: '@everyone',
                embeds: [embed]
            });

        } catch (error) {
            console.error('[!] Error en !anuncio:', error);
            message.reply('❌ Error al enviar el anuncio.');
        }
    }

    // ===== COMANDO: !ticket =====
    if (command === 'ticket') {
        // Verificar que el usuario tiene el rol permitido
        if (!message.member.roles.cache.has(ROLE_ID)) {
            return message.reply('❌ No tienes permiso para usar este comando.');
        }

        try {
            // Eliminar el mensaje del usuario
            await message.delete().catch(() => {});

            // Crear embed del panel de tickets
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎫 Sistema de Tickets')
                .setDescription('Haz clic en el botón de abajo para crear un ticket de soporte.\n\nUn administrador te atenderá lo antes posible.')
                .setFooter({ text: 'Sistema de Tickets - ForensicShield' });

            // Crear botones
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('create_ticket')
                        .setLabel('🎫 Crear Ticket')
                        .setStyle(ButtonStyle.Primary)
                );

            // Enviar el mensaje con el panel
            await message.channel.send({
                embeds: [embed],
                components: [row]
            });

        } catch (error) {
            console.error('[!] Error en !ticket:', error);
            message.reply('❌ Error al crear el panel de tickets.');
        }
    }
});

// ============ INTERACCIONES (BOTONES) ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // ===== CREAR TICKET =====
    if (interaction.customId === 'create_ticket') {
        try {
            // Verificar si el usuario ya tiene un ticket abierto
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

            // Buscar o crear la categoría "Tickets"
            let category = guild.channels.cache.find(ch => ch.name === 'Tickets' && ch.type === ChannelType.GuildCategory);
            if (!category) {
                category = await guild.channels.create({
                    name: 'Tickets',
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: ROLE_ID,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                        }
                    ]
                });
            }

            // Crear el canal del ticket
            const channel = await guild.channels.create({
                name: `ticket-${interaction.user.id}`,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                    },
                    {
                        id: ROLE_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                    }
                ]
            });

            // Mensaje de bienvenida en el ticket
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
                content: '❌ Error al crear el ticket. Contacta con un administrador.',
                ephemeral: true
            });
        }
    }

    // ===== CERRAR TICKET =====
    if (interaction.customId === 'close_ticket') {
        try {
            // Verificar que el usuario es el dueño del ticket o tiene el rol
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