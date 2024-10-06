import dotenv from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder, Colors } from 'discord.js';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

// Configuração do Discord
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

let TWITCH_USERS = process.env.TWITCH_USERS.split(','); // Carregar streamers do .env
let twitchAccessToken = '';
let monitoredStreams = new Map(); // Para monitorar os streamers que estão ao vivo
let liveStreamers = [];

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
      return null; // Stream offline
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

    if (streamData) {
      const { stream, profileImageUrl } = streamData;
      const thumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225'); // Miniatura da stream em 400x225

      // Verificar se já existe uma mensagem para esse streamer
      if (!monitoredStreams.has(twitchUser)) {
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
      } else {
        // Atualizar a mensagem existente
        const { liveMessage } = monitoredStreams.get(twitchUser);
        await liveMessage.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${twitchUser} está ao vivo na Twitch!`)
              .setURL(`https://twitch.tv/${twitchUser}`)
              .setDescription(`**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`)
              .setThumbnail(profileImageUrl)
              .setImage(thumbnailUrl)
              .setColor(Colors.Red)
              .setFooter({ text: 'Clique no título para assistir à live' })
          ]
        });
      }

      liveStreamers.push(twitchUser); // Adiciona o streamer à lista de streamers ao vivo
    }
  }

  // Remover streamers que não estão mais ao vivo
  for (const [twitchUser, { liveMessage }] of monitoredStreams.entries()) {
    if (!liveStreamers.includes(twitchUser)) {
      await liveMessage.delete();
      monitoredStreams.delete(twitchUser);
    }
  }

  // Atualizar a atividade do bot
  if (liveStreamers.length > 0) {
    client.user.setActivity(`Observando ${liveStreamers.length} streamer(s) ao vivo`, { type: 'WATCHING' });
  } else {
    client.user.setActivity('Nada ao vivo no momento', { type: 'WATCHING' });
  }
}

// Inicializar o bot
client.once('ready', async () => {
  console.log('Bot está online!');

  await getTwitchAccessToken(); // Obter o token de acesso da Twitch

  setInterval(checkTwitchStreams, 30000); // Verificar as streams a cada 30 segundos
});

// Login do bot
client.login(DISCORD_TOKEN);
