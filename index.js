import { config } from 'dotenv';
import { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import axios from 'axios';
import fs from 'fs';

// Configuração do Discord
config(); // Carregar variáveis de ambiente

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;

let TWITCH_USERS = process.env.TWITCH_USERS.split(','); // Carregar streamers do .env
let twitchAccessToken = '';
let monitoredStreams = new Map(); // Para monitorar os streamers que estão ao vivo
let liveStreamers = [];
let currentStreamerIndex = 0;

// Função para obter o token de acesso da Twitch
async function getTwitchAccessToken() {
  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials',
      },
    });
    twitchAccessToken = response.data.access_token;
  } catch (error) {
    console.error('Erro ao obter o token da Twitch:', error);
  }
}

// Função para verificar se um canal está ao vivo
async function checkStream(twitchUser) {
  try {
    const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${twitchUser}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${twitchAccessToken}`,
      },
    });

    if (response.data.data.length > 0) {
      const userResponse = await axios.get(`https://api.twitch.tv/helix/users?login=${twitchUser}`, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          Authorization: `Bearer ${twitchAccessToken}`,
        },
      });

      const profileImageUrl = userResponse.data.data[0].profile_image_url;

      return { stream: response.data.data[0], profileImageUrl };
    } else {
      return null;
    }
  } catch (error) {
    console.error('Erro ao verificar o status do stream:', error);
    return null;
  }
}

// Função para verificar as lives da Twitch periodicamente
async function checkTwitchStreams() {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  liveStreamers = [];

  // Limpa o chat antes de verificar
  const messages = await channel.messages.fetch({ limit: 100 });
  await channel.bulkDelete(messages);

  for (const twitchUser of TWITCH_USERS) {
    const streamData = await checkStream(twitchUser);

    if (streamData && !monitoredStreams.has(twitchUser)) {
      const { stream, profileImageUrl } = streamData;
      const thumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '80'); // Miniatura da stream em 400x80

      const updatedEmbed = new EmbedBuilder()
        .setTitle(`${twitchUser} está ao vivo na Twitch!`)
        .setURL(`https://twitch.tv/${twitchUser}`)
        .setDescription(`**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`)
        .setThumbnail(profileImageUrl)
        .setImage(thumbnailUrl)
        .setColor(Colors.Red)
        .setFooter({ text: 'Clique no título para assistir à live' });

      const liveMessage = await channel.send({ content: `🔴 @everyone ${twitchUser} está ao vivo!`, embeds: [updatedEmbed] });
      monitoredStreams.set(twitchUser, { liveMessage, game: stream.game_name });

      liveStreamers.push({ username: twitchUser, game: stream.game_name });
    } else if (!streamData && monitoredStreams.has(twitchUser)) {
      const liveMessage = monitoredStreams.get(twitchUser).liveMessage;
      await liveMessage.delete();
      monitoredStreams.delete(twitchUser);
      liveStreamers = liveStreamers.filter(s => s.username !== twitchUser);
    }
  }
}

// Rotação de presença
function rotatePresence() {
  console.log("Rotating presence...");

  if (liveStreamers.length > 0) {
    const streamer = liveStreamers[currentStreamerIndex];

    if (streamer) {
      console.log(`Agora assistindo: ${streamer.username} jogando ${streamer.game}`);
      client.user.setActivity(`assistindo ${streamer.username} jogar ${streamer.game}`, { type: 'WATCHING' });
      currentStreamerIndex = (currentStreamerIndex + 1) % liveStreamers.length;
    }
  } else {
    console.log("Nenhum streamer ao vivo.");
    client.user.setActivity(null);
  }
}

// Configurar o bot para alternar o presence a cada 1 minuto
setInterval(rotatePresence, 60 * 1000);

// Adicionar um novo streamer ao .env e à lista
function addTwitchUser(username) {
  if (!TWITCH_USERS.includes(username)) {
    TWITCH_USERS.push(username);
    updateEnvConfig();
    console.log(`Streamer ${username} adicionado!`);
  }
}

// Remover um streamer da lista
function removeTwitchUser(username) {
  if (TWITCH_USERS.includes(username)) {
    TWITCH_USERS = TWITCH_USERS.filter(user => user !== username);
    updateEnvConfig();
    console.log(`Streamer ${username} removido!`);
  }
}

// Atualiza o arquivo .env
function updateEnvConfig() {
  const envConfig = fs.readFileSync('.env', 'utf8');
  const updatedEnvConfig = envConfig.replace(
    /^TWITCH_USERS=.*$/m,
    `TWITCH_USERS=${TWITCH_USERS.join(',')}`
  );
  fs.writeFileSync('.env', updatedEnvConfig);
}

// Configurar os comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'twitch') {
    const username = options.getString('username');

    if (TWITCH_USERS.includes(username)) {
      await interaction.reply(`${username} já está na lista.`);
    } else {
      addTwitchUser(username);
      await interaction.reply(`Streamer ${username} adicionado à lista.`);
    }
  } else if (commandName === 'remover') {
    const username = options.getString('username');

    if (!TWITCH_USERS.includes(username)) {
      await interaction.reply(`${username} não está na lista.`);
    } else {
      removeTwitchUser(username);
      await interaction.reply(`Streamer ${username} removido da lista.`);
    }
  }
});

// Configuração do bot
client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  const data = new SlashCommandBuilder()
    .setName('twitch')
    .setDescription('Adiciona um streamer da Twitch para ser monitorado')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Nome do usuário da Twitch')
        .setRequired(true)
    );

  const removeCommand = new SlashCommandBuilder()
    .setName('remover')
    .setDescription('Remove um streamer da Twitch da lista de monitoramento')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Nome do usuário da Twitch')
        .setRequired(true)
    );

  await client.application.commands.create(data.toJSON(), GUILD_ID);
  await client.application.commands.create(removeCommand.toJSON(), GUILD_ID);

  // Iniciar verificação a cada 60 segundos
  await getTwitchAccessToken();
  setInterval(checkTwitchStreams, 60000);
});

// Iniciar o bot
client.login(DISCORD_TOKEN);
