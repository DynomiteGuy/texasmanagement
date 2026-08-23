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
const MOD_LOG_CHANNEL_ID = process.env.MOD_LOG_CHANNEL_ID;

// Parses strings like "10m", "2h", "7d", "1w" into milliseconds. Returns null if unparseable.
function parseDuration(input) {
  if (!input) return null;
  const match = input.trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return amount * unitMs[unit];
}

async function sendModLog(guild, { action, target, moderator, reason, proof, duration, color }) {
  if (!MOD_LOG_CHANNEL_ID) return;
  try {
    const logChannel = await guild.channels.fetch(MOD_LOG_CHANNEL_ID);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(action)
      .setColor(color)
      .addFields(
        { name: 'User', value: `${target} (${target.id})`, inline: true },
        { name: 'Moderator', value: `${moderator}`, inline: true },
        { name: 'Reason', value: reason || 'No reason provided' }
      )
      .setTimestamp();

    if (duration) embed.addFields({ name: 'Duration', value: duration });
    if (proof) embed.addFields({ name: 'Proof', value: proof });
    if (proof && /\.(png|jpe?g|gif|webp)$/i.test(proof)) embed.setImage(proof);

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Could not send mod log:', err);
  }
}

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
          `👋 Welcome to the server ${member}, we are excited to see you here! You are member #${member.guild.memberCount}.`
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

  // Slash command: /kick
  if (interaction.isChatInputCommand() && interaction.commandName === 'kick') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
      return interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason');
    const proof = interaction.options.getAttachment('proof');

    if (!target) {
      return interaction.reply({ content: 'Could not find that member.', ephemeral: true });
    }
    if (!target.kickable) {
      return interaction.reply({
        content: "I can't kick that member. Check my role is above theirs.",
        ephemeral: true,
      });
    }

    try {
      await target.kick(reason || 'No reason provided');
      await sendModLog(interaction.guild, {
        action: '👢 Member Kicked',
        target: target.user,
        moderator: interaction.user,
        reason,
        proof: proof?.url,
        color: 0xfee75c,
      });
      return interaction.reply({ content: `Kicked ${target.user.tag}.`, ephemeral: true });
    } catch (err) {
      console.error('Kick failed:', err);
      return interaction.reply({ content: 'Something went wrong trying to kick that member.', ephemeral: true });
    }
  }

  // Slash command: /ban
  if (interaction.isChatInputCommand() && interaction.commandName === 'ban') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason');
    const proof = interaction.options.getAttachment('proof');
    const durationInput = interaction.options.getString('duration');

    if (!target) {
      return interaction.reply({ content: 'Could not find that member.', ephemeral: true });
    }
    if (!target.bannable) {
      return interaction.reply({
        content: "I can't ban that member. Check my role is above theirs.",
        ephemeral: true,
      });
    }

    let durationMs = null;
    if (durationInput) {
      durationMs = parseDuration(durationInput);
      if (!durationMs) {
        return interaction.reply({
          content: 'Invalid duration format. Use something like 10m, 2h, 7d, or 1w.',
          ephemeral: true,
        });
      }
    }

    const guildId = interaction.guild.id;
    const userId = target.id;

    try {
      await target.ban({ reason: reason || 'No reason provided' });
      await sendModLog(interaction.guild, {
        action: '🔨 Member Banned',
        target: target.user,
        moderator: interaction.user,
        reason,
        proof: proof?.url,
        duration: durationInput ? durationInput : 'Permanent',
        color: 0xed4245,
      });

      // Note: this timer only lives in memory. If the bot restarts before it fires,
      // the scheduled unban is lost and the ban will stay permanent until manually lifted.
      if (durationMs) {
        setTimeout(async () => {
          try {
            const guild = await client.guilds.fetch(guildId);
            await guild.members.unban(userId, 'Temporary ban expired');
          } catch (err) {
            console.error('Could not auto-unban:', err);
          }
        }, durationMs);
      }

      return interaction.reply({
        content: `Banned ${target.user.tag}${durationInput ? ` for ${durationInput}` : ' permanently'}.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('Ban failed:', err);
      return interaction.reply({ content: 'Something went wrong trying to ban that member.', ephemeral: true });
    }
  }

  // Slash command: /mute (timeout)
  if (interaction.isChatInputCommand() && interaction.commandName === 'mute') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason');
    const proof = interaction.options.getAttachment('proof');
    const durationInput = interaction.options.getString('duration') || '1h';

    if (!target) {
      return interaction.reply({ content: 'Could not find that member.', ephemeral: true });
    }
    if (!target.moderatable) {
      return interaction.reply({
        content: "I can't mute that member. Check my role is above theirs.",
        ephemeral: true,
      });
    }

    const durationMs = parseDuration(durationInput);
    if (!durationMs) {
      return interaction.reply({
        content: 'Invalid duration format. Use something like 10m, 2h, 7d (max 28d).',
        ephemeral: true,
      });
    }
    if (durationMs > 28 * 86400000) {
      return interaction.reply({ content: 'Discord timeouts cannot exceed 28 days.', ephemeral: true });
    }

    try {
      await target.timeout(durationMs, reason || 'No reason provided');
      await sendModLog(interaction.guild, {
        action: '🔇 Member Muted',
        target: target.user,
        moderator: interaction.user,
        reason,
        proof: proof?.url,
        duration: durationInput,
        color: 0x5865f2,
      });
      return interaction.reply({ content: `Muted ${target.user.tag} for ${durationInput}.`, ephemeral: true });
    } catch (err) {
      console.error('Mute failed:', err);
      return interaction.reply({ content: 'Something went wrong trying to mute that member.', ephemeral: true });
    }
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
