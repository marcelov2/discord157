import { config } from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder, Colors } from 'discord.js';
import axios from 'axios';

// Configuração do Discord e variáveis de ambiente
config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
let TWITCH_USERS = process.env.TWITCH_USERS.split(',');
let twitchAccessToken = '';
let monitoredStreams = new Map();
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

// Função para limpar o chat quando o bot desconectar
async function clearChat(channel) {
  let messages;
  do {
    messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size === 0) break;
    await channel.bulkDelete(messages).catch(error => console.error('Erro ao limpar mensagens:', error));
  } while (messages.size > 0);
}

// Função para verificar as lives da Twitch periodicamente
async function checkTwitchStreams() {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  liveStreamers = [];

  for (const twitchUser of TWITCH_USERS) {
    const streamData = await checkStream(twitchUser);
    if (streamData && !monitoredStreams.has(twitchUser)) {
      const { stream, profileImageUrl } = streamData;
      const thumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225') + `?time=${Date.now()}`;

      const liveEmbed = new EmbedBuilder()
        .setTitle(`${twitchUser} está ao vivo na Twitch!`)
        .setURL(`https://twitch.tv/${twitchUser}`)
        .setDescription(`**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`)
        .setThumbnail(profileImageUrl)
        .setImage(thumbnailUrl)
        .setColor(Colors.Red)
        .setFooter({ text: 'Clique no título para assistir à live' });

      const liveMessage = await channel.send({ content: `🔴 @everyone ${twitchUser} está ao vivo!`, embeds: [liveEmbed] });
      monitoredStreams.set(twitchUser, { liveMessage, game: stream.game_name });
      liveStreamers.push({ username: twitchUser, game: stream.game_name });
      rotatePresence();
    } else if (!streamData && monitoredStreams.has(twitchUser)) {
      const liveMessage = monitoredStreams.get(twitchUser).liveMessage;
      await liveMessage.delete();
      monitoredStreams.delete(twitchUser);
      liveStreamers = liveStreamers.filter(s => s.username !== twitchUser);
    }
  }
}

// Função para atualizar as thumbnails, jogo e contagem de visualizações das streams ao vivo
async function updateThumbnails() {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);

  for (const [twitchUser, streamInfo] of monitoredStreams.entries()) {
    const streamData = await checkStream(twitchUser);
    if (streamData) {
      const { stream, profileImageUrl } = streamData;
      const thumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225') + `?time=${Date.now()}`;

      const updatedEmbed = new EmbedBuilder()
        .setTitle(`${twitchUser} está ao vivo na Twitch!`)
        .setURL(`https://twitch.tv/${twitchUser}`)
        .setDescription(`**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`)
        .setThumbnail(profileImageUrl)
        .setImage(thumbnailUrl)
        .setColor(Colors.Red)
        .setFooter({ text: 'Clique no título para assistir à live' });

      await streamInfo.liveMessage.edit({ embeds: [updatedEmbed] });
    }
  }
}

// Função para atualizar a presença do bot
function rotatePresence() {
  if (liveStreamers.length > 0) {
    const streamer = liveStreamers[currentStreamerIndex];
    if (streamer) {
      client.user.setActivity(`assistindo ${streamer.username} jogar ${streamer.game}`, { type: 'WATCHING' });
      currentStreamerIndex = (currentStreamerIndex + 1) % liveStreamers.length;
    }
  } else {
    client.user.setActivity(null);
  }
}

// Função para reiniciar o bot a cada 12 horas
function restartBotIn12Hours() {
  let remainingTime = 12 * 60 * 60 * 1000; // 12 horas em milissegundos
  const interval = setInterval(() => {
    remainingTime -= 60 * 1000; // Diminui 1 minuto
    const hours = Math.floor(remainingTime / (1000 * 60 * 60));
    const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
    console.log(`Reinício em: ${hours} horas e ${minutes} minutos...`);

    // Quando o tempo restante for 0, reiniciar o bot
    if (remainingTime <= 0) {
      clearInterval(interval); // Para o intervalo
      console.log("Reiniciando o bot agora...");
      process.exit(); // Finaliza o processo para reiniciar o bot
    }
  }, 60 * 1000); // A cada 1 minuto
}

// Inicialização do bot
client.once('ready', async () => {
  console.log('Bot está online!');
  await getTwitchAccessToken();

  // Limpa o chat antes de iniciar a verificação das lives
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  await clearChat(channel);

  // Começa a monitorar os streamers e suas lives
  setInterval(checkTwitchStreams, 60 * 1000);  // Verifica as lives a cada 1 minuto
  setInterval(updateThumbnails, 15 * 60 * 1000);  // Atualiza as thumbnails a cada 15 minutos
  restartBotIn12Hours();  // Reinicia o bot a cada 12 horas
});

client.login(DISCORD_TOKEN);
