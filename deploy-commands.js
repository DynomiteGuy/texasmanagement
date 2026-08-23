require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('postverify')
    .setDescription('Post the verification embed in this channel'),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption((opt) => opt.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the kick').setRequired(false))
    .addAttachmentOption((opt) =>
      opt.setName('proof').setDescription('Screenshot or evidence').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption((opt) => opt.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the ban').setRequired(false))
    .addAttachmentOption((opt) =>
      opt.setName('proof').setDescription('Screenshot or evidence').setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('duration')
        .setDescription('e.g. 10m, 2h, 7d, 1w — leave blank for permanent')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout (mute) a member')
    .addUserOption((opt) => opt.setName('user').setDescription('Member to mute').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('duration').setDescription('e.g. 10m, 2h, 7d — max 28d (defaults to 1h)').setRequired(false)
    )
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the mute').setRequired(false))
    .addAttachmentOption((opt) =>
      opt.setName('proof').setDescription('Screenshot or evidence').setRequired(false)
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {
      body: commands,
    });
    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error(error);
  }
})();
