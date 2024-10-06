require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const axios = require('axios');
const fs = require('fs');

// Configuração do Discord
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

  for (const twitchUser of TWITCH_USERS) {
    const streamData = await checkStream(twitchUser);

    if (streamData && !monitoredStreams.has(twitchUser)) {
      const { stream, profileImageUrl } = streamData;
      const thumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225'); // Miniatura da stream em 400x225

      const updatedEmbed = new EmbedBuilder()
        .setTitle(`${twitchUser} está ao vivo na Twitch!`)
        .setURL(`https://twitch.tv/${twitchUser}`)
        .setDescription(`**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`)
        .setThumbnail(profileImageUrl)
        .setImage(thumbnailUrl)
        .setColor(Colors.Red) // Usando Colors.Red
        .setFooter({ text: 'Clique no título para assistir à live' });

      const liveMessage = await channel.send({ content: `🔴 @everyone ${twitchUser} está ao vivo!`, embeds: [updatedEmbed] });
      monitoredStreams.set(twitchUser, { liveMessage, game: stream.game_name, lastUpdated: Date.now() });
      liveStreamers.push({ username: twitchUser, game: stream.game_name });
    } else if (streamData && monitoredStreams.has(twitchUser)) {
      const { liveMessage } = monitoredStreams.get(twitchUser);

      const currentTime = Date.now();
      const timeSinceLastUpdate = currentTime - monitoredStreams.get(twitchUser).lastUpdated;

      if (timeSinceLastUpdate >= 1800000) { // 30 minutos
        const newThumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225'); // Miniatura da stream em 400x225

        await liveMessage.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${twitchUser} está ao vivo na Twitch!`)
              .setURL(`https://twitch.tv/${twitchUser}`)
              .setDescription(`**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`)
              .setThumbnail(profileImageUrl)
              .setImage(newThumbnailUrl)
              .setColor(Colors.Red)
              .setFooter({ text: 'Clique no título para assistir à live' })
          ]
        });

        // Atualiza o tempo da última atualização
        monitoredStreams.get(twitchUser).lastUpdated = currentTime;
      }
    } else if (!streamData && monitoredStreams.has(twitchUser)) {
      const liveMessage = monitoredStreams.get(twitchUser).liveMessage;
      await liveMessage.delete();
      monitoredStreams.delete(twitchUser);
      liveStreamers = liveStreamers.filter(s => s.username !== twitchUser);
    }
  }
}

function rotatePresence() {
  console.log("Rotating presence..."); // Mensagem de depuração

  if (liveStreamers.length > 0) {
    const streamer = liveStreamers[currentStreamerIndex];

    if (streamer) { // Verifica se o streamer é válido
      console.log(`Agora assistindo: ${streamer.username} jogando ${streamer.game}`); // Mensagem de depuração
      client.user.setActivity(`assistindo ${streamer.username} jogar ${streamer.game}`, { type: 'WATCHING' });
      currentStreamerIndex = (currentStreamerIndex + 1) % liveStreamers.length;
    }
  } else {
    console.log("Nenhum streamer ao vivo."); // Mensagem de depuração
    client.user.setActivity(null);
  }
}

// Configurar o bot para alternar o presence a cada 1 minuto
setInterval(rotatePresence, 60 * 1000);

// Adicionar um novo streamer ao .env e à lista
function addTwitchUser(username) {
  if (!TWITCH_USERS.includes(username)) {
    TWITCH_USERS.push(username);

    const envConfig = fs.readFileSync('.env', 'utf8');
    const updatedEnvConfig = envConfig.replace(
      /^TWITCH_USERS=.*$/m,
      `TWITCH_USERS=${TWITCH_USERS.join(',')}`
    );
    fs.writeFileSync('.env', updatedEnvConfig);

    console.log(`Streamer ${username} adicionado!`);
  }
}

// Remover um streamer da lista
function removeTwitchUser(username) {
  if (TWITCH_USERS.includes(username)) {
    TWITCH_USERS = TWITCH_USERS.filter(user => user !== username);

    const envConfig = fs.readFileSync('.env', 'utf8');
    const updatedEnvConfig = envConfig.replace(
      /^TWITCH_USERS=.*$/m,
      `TWITCH_USERS=${TWITCH_USERS.join(',')}`
    );
    fs.writeFileSync('.env', updatedEnvConfig);

    console.log(`Streamer ${username} removido!`);
  }
}

// Iniciar o bot
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await getTwitchAccessToken();
  setInterval(checkTwitchStreams, 30000); // Verifica as streams a cada 30 segundos
});

// Iniciar o bot
client.login(DISCORD_TOKEN);
