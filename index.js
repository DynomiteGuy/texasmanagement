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
const db = require('./db');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const DAY_MS = 86400000;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

client.once('ready', async () => {
  await db.init();
  console.log(`Logged in as ${client.user.tag}`);
  checkShiftResets();
  setInterval(checkShiftResets, 60 * 60 * 1000); // check hourly
});

// Sums every (\d+)(s|m|h|d|w) chunk in a string into total seconds, e.g. "1h30m" -> 5400
function parseDurationToSeconds(input) {
  if (!input) return null;
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const matches = [...input.matchAll(/(\d+)\s*(s|m|h|d|w)/gi)];
  if (matches.length === 0) return null;
  let total = 0;
  for (const m of matches) {
    total += parseInt(m[1], 10) * unitSeconds[m[2].toLowerCase()];
  }
  return total;
}

function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours === 0 && minutes === 0) return `${s % 60}s`;
  return `${hours}h ${minutes}m`;
}

function hasHrPermission(interaction, guildConfig) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (guildConfig?.hr_role_id && interaction.member.roles.cache.has(guildConfig.hr_role_id)) return true;
  return false;
}

// Finds the next date/time (UTC midnight) matching `weekday` that is strictly after `fromDate`
function nextWeekdayAfter(fromDate, weekday) {
  const d = new Date(fromDate);
  d.setUTCHours(0, 0, 0, 0);
  let diff = (weekday - d.getUTCDay() + 7) % 7;
  if (diff === 0) diff = 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

async function checkShiftResets() {
  try {
    const guilds = await db.getGuildsWithResetSchedule();
    const now = new Date();
    for (const g of guilds) {
      let periodStart = new Date(g.current_period_start);
      let changed = false;

      if (g.reset_mode === 'weekday') {
        let nextReset = nextWeekdayAfter(periodStart, g.reset_weekday);
        while (now >= nextReset) {
          periodStart = nextReset;
          nextReset = nextWeekdayAfter(periodStart, g.reset_weekday);
          changed = true;
        }
      } else if (g.reset_mode === 'interval' && g.reset_interval_days) {
        let nextReset = new Date(periodStart.getTime() + g.reset_interval_days * DAY_MS);
        while (now >= nextReset) {
          periodStart = nextReset;
          nextReset = new Date(periodStart.getTime() + g.reset_interval_days * DAY_MS);
          changed = true;
        }
      }

      if (changed) {
        await db.setPeriodStart(g.guild_id, periodStart.toISOString());
        console.log(`Shift period reset for guild ${g.guild_id}`);
      }
    }
  } catch (err) {
    console.error('Error checking shift resets:', err);
  }
}

async function buildShiftPayload(guildId, userId) {
  const guildConfig = await db.getGuildConfig(guildId);
  const periodStart = guildConfig?.current_period_start || null;

  const active = await db.getActiveShift(guildId, userId);
  const total = await db.getTotalSeconds(guildId, userId, periodStart);
  const currentSeconds = active
    ? Math.floor((Date.now() - new Date(active.start_time).getTime()) / 1000)
    : 0;

  const embed = new EmbedBuilder()
    .setTitle('🕒 Shift Tracker')
    .setColor(active ? 0x57f287 : 0x99aab5)
    .addFields(
      { name: 'Status', value: active ? '🟢 On duty' : '⚪ Off duty', inline: true },
      { name: 'Current Shift', value: active ? formatSeconds(currentSeconds) : '—', inline: true },
      {
        name: periodStart ? 'This Period' : 'Total Shift Time',
        value: formatSeconds(total + currentSeconds),
        inline: true,
      }
    );

  if (periodStart) {
    embed.setFooter({
      text: `Period started ${new Date(periodStart).toDateString()}`,
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('shift_start')
      .setLabel('Start Shift')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!active),
    new ButtonBuilder()
      .setCustomId('shift_stop')
      .setLabel('End Shift')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!active)
  );

  return { embeds: [embed], components: [row] };
}

client.on('interactionCreate', async (interaction) => {
  try {
    // /shift
    if (interaction.isChatInputCommand() && interaction.commandName === 'shift') {
      const payload = await buildShiftPayload(interaction.guild.id, interaction.user.id);
      return interaction.reply({ ...payload, ephemeral: true });
    }

    // /shift-leaderboard
    if (interaction.isChatInputCommand() && interaction.commandName === 'shift-leaderboard') {
      const guildConfig = await db.getGuildConfig(interaction.guild.id);
      const periodStart = guildConfig?.current_period_start || null;
      const rows = await db.getLeaderboard(interaction.guild.id, 10, periodStart);
      if (rows.length === 0) {
        return interaction.reply({ content: 'No shift data logged yet.', ephemeral: true });
      }
      const lines = rows.map((r, i) => `**${i + 1}.** <@${r.userId}> — ${formatSeconds(r.totalSeconds)}`);
      const embed = new EmbedBuilder()
        .setTitle('🏆 Shift Leaderboard')
        .setDescription(lines.join('\n'))
        .setColor(0xfee75c);
      if (periodStart) {
        embed.setFooter({ text: `Since ${new Date(periodStart).toDateString()}` });
      }
      return interaction.reply({ embeds: [embed] });
    }

    // /shift-manage
    if (interaction.isChatInputCommand() && interaction.commandName === 'shift-manage') {
      const guildConfig = await db.getGuildConfig(interaction.guild.id);
      if (!hasHrPermission(interaction, guildConfig)) {
        return interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
      }

      const target = interaction.options.getUser('user');
      const action = interaction.options.getString('action');
      const amountInput = interaction.options.getString('amount');
      const reason = interaction.options.getString('reason');

      const seconds = parseDurationToSeconds(amountInput);
      if (!seconds) {
        return interaction.reply({
          content: 'Invalid amount format. Use something like 30m, 1h, or 1h30m.',
          ephemeral: true,
        });
      }

      const signedSeconds = action === 'subtract' ? -seconds : seconds;
      await db.adjustShift(interaction.guild.id, target.id, signedSeconds);

      const newTotal = await db.getTotalSeconds(
        interaction.guild.id,
        target.id,
        guildConfig?.current_period_start || null
      );
      return interaction.reply({
        content: `${action === 'subtract' ? 'Removed' : 'Added'} ${formatSeconds(seconds)} ${
          action === 'subtract' ? 'from' : 'to'
        } ${target}'s shift time${reason ? ` (${reason})` : ''}. New total: ${formatSeconds(newTotal)}.`,
        ephemeral: true,
      });
    }

    // /dmotw
    if (interaction.isChatInputCommand() && interaction.commandName === 'dmotw') {
      const guildConfig = await db.getGuildConfig(interaction.guild.id);
      if (!hasHrPermission(interaction, guildConfig)) {
        return interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
      }

      const target = interaction.options.getUser('user');
      const template =
        guildConfig?.dmotw_message ||
        "🎉 Congratulations {user}, you are this week's Department Member of the Week! Thank you for your outstanding service!";
      const message = template.replaceAll('{user}', `${target}`);

      const channelId = guildConfig?.dmotw_channel_id;
      const targetChannel = channelId
        ? await interaction.guild.channels.fetch(channelId).catch(() => null)
        : interaction.channel;

      if (!targetChannel) {
        return interaction.reply({ content: 'Could not find the configured DMOTW channel.', ephemeral: true });
      }

      await targetChannel.send(message);
      return interaction.reply({ content: `Posted DMOTW announcement for ${target.tag}.`, ephemeral: true });
    }

    // /config
    if (interaction.isChatInputCommand() && interaction.commandName === 'config') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
      }

      const group = interaction.options.getSubcommandGroup(false);
      const sub = interaction.options.getSubcommand();

      if (group === 'shift-reset') {
        if (sub === 'weekday') {
          const day = parseInt(interaction.options.getString('day'), 10);
          await db.setShiftReset(interaction.guild.id, 'weekday', { weekday: day });
          return interaction.reply({
            content: `Shift totals and the leaderboard will now reset every ${DAY_NAMES[day]}. Current period starts now.`,
            ephemeral: true,
          });
        }
        if (sub === 'interval') {
          const days = interaction.options.getInteger('days');
          await db.setShiftReset(interaction.guild.id, 'interval', { intervalDays: days });
          return interaction.reply({
            content: `Shift totals will now reset every ${days} day(s) ("wave" length). Current wave starts now.`,
            ephemeral: true,
          });
        }
        if (sub === 'off') {
          await db.clearShiftReset(interaction.guild.id);
          return interaction.reply({
            content: 'Automatic shift resets turned off — totals now track all-time again.',
            ephemeral: true,
          });
        }
        return;
      }

      if (sub === 'hr-role') {
        const role = interaction.options.getRole('role');
        await db.upsertGuildConfig(interaction.guild.id, { hr_role_id: role.id });
        return interaction.reply({ content: `HR role set to ${role}.`, ephemeral: true });
      }

      if (sub === 'dmotw-message') {
        const message = interaction.options.getString('message');
        await db.upsertGuildConfig(interaction.guild.id, { dmotw_message: message });
        return interaction.reply({ content: 'DMOTW message template updated.', ephemeral: true });
      }

      if (sub === 'dmotw-channel') {
        const channel = interaction.options.getChannel('channel');
        await db.upsertGuildConfig(interaction.guild.id, { dmotw_channel_id: channel.id });
        return interaction.reply({ content: `DMOTW announcements will now post in ${channel}.`, ephemeral: true });
      }
    }

    // Buttons
    if (interaction.isButton() && interaction.customId === 'shift_start') {
      const active = await db.getActiveShift(interaction.guild.id, interaction.user.id);
      if (!active) {
        await db.startShift(interaction.guild.id, interaction.user.id);
      }
      const payload = await buildShiftPayload(interaction.guild.id, interaction.user.id);
      return interaction.update(payload);
    }

    if (interaction.isButton() && interaction.customId === 'shift_stop') {
      const active = await db.getActiveShift(interaction.guild.id, interaction.user.id);
      if (active) {
        await db.endShift(interaction.guild.id, interaction.user.id);
      }
      const payload = await buildShiftPayload(interaction.guild.id, interaction.user.id);
      return interaction.update(payload);
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
