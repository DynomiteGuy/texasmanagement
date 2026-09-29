require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('shift').setDescription('View your shift status and clock in/out'),

  new SlashCommandBuilder()
    .setName('shift-leaderboard')
    .setDescription('See who has the most shift time in this server'),

  new SlashCommandBuilder()
    .setName('shift-manage')
    .setDescription('Add or subtract shift time for a member (HR only)')
    .addUserOption((opt) => opt.setName('user').setDescription('Member to adjust').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription('Add or subtract time')
        .setRequired(true)
        .addChoices({ name: 'Add', value: 'add' }, { name: 'Subtract', value: 'subtract' })
    )
    .addStringOption((opt) =>
      opt.setName('amount').setDescription('e.g. 30m, 1h, 1h30m').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for the adjustment').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('dmotw')
    .setDescription('Announce Department Member of the Week (HR only)')
    .addUserOption((opt) => opt.setName('user').setDescription('Member to congratulate').setRequired(true)),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription("Configure this server's settings (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('hr-role')
        .setDescription('Set the role allowed to use HR commands')
        .addRoleOption((opt) => opt.setName('role').setDescription('The HR role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('dmotw-message')
        .setDescription('Set the DMOTW message template (use {user} for the mention)')
        .addStringOption((opt) => opt.setName('message').setDescription('Message template').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('dmotw-channel')
        .setDescription('Set the channel DMOTW announcements post in')
        .addChannelOption((opt) => opt.setName('channel').setDescription('Target channel').setRequired(true))
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering global slash commands (can take up to ~1 hour to fully propagate)...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error(error);
  }
})();
