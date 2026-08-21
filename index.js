require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // needed so we can auto-assign the Unverified role on join
  ],
});

const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Give new members the Unverified role the moment they join, and welcome them
client.on('guildMemberAdd', async (member) => {
  try {
    if (UNVERIFIED_ROLE_ID) {
      await member.roles.add(UNVERIFIED_ROLE_ID);
    }
  } catch (err) {
    console.error(`Could not add unverified role to ${member.user.tag}:`, err);
  }

  try {
    if (WELCOME_CHANNEL_ID) {
      const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
      if (channel) {
        await channel.send(
          `👋 Welcome to **Texas State Roleplay** ${member}, we are excited to see you here! You are member #${member.guild.memberCount}. Please read our regulations and make sure to follow them at all times!`
        );
      }
    }
  } catch (err) {
    console.error(`Could not send welcome message for ${member.user.tag}:`, err);
  }
});

client.on('interactionCreate', async (interaction) => {
  // Slash command: /postverify -> posts the embed in the current channel
  if (interaction.isChatInputCommand() && interaction.commandName === 'postverify') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Server Verification')
      .setDescription('Click the button below to verify yourself and gain access to the server.')
      .setColor(0x57f287);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_checkmark')
        .setLabel('Verify')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: 'Verification embed posted.', ephemeral: true });
  }

  // Button click: verify_checkmark -> swap roles
  if (interaction.isButton() && interaction.customId === 'verify_checkmark') {
    const member = interaction.member;

    try {
      if (VERIFIED_ROLE_ID && !member.roles.cache.has(VERIFIED_ROLE_ID)) {
        await member.roles.add(VERIFIED_ROLE_ID);
      }
      if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
        await member.roles.remove(UNVERIFIED_ROLE_ID);
      }
      await interaction.reply({ content: "You're verified! Welcome to the server.", ephemeral: true });
    } catch (err) {
      console.error('Error assigning roles:', err);
      await interaction.reply({
        content:
          'Something went wrong verifying you. This usually means the bot role needs to be moved above the Verified/Unverified roles in Server Settings > Roles.',
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
