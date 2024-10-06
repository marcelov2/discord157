const { Client, GatewayIntentBits, EmbedBuilder, Colors } = require('discord.js');
const axios = require('axios');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
require('dotenv').config();

const TWITCH_USERS = ['marcelov2']; // Lista de usuários do Twitch
const DISCORD_CHANNEL_ID = 'seu-canal-id'; // Substitua pelo ID do canal do Discord
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_ACCESS_TOKEN = process.env.TWITCH_ACCESS_TOKEN;
let monitoredStreams = new Map();
let liveStreamers = [];

// Função para limpar o chat, incluindo as mensagens do próprio bot
async function clearChat(channel) {
  try {
    const fetchedMessages = await channel.messages.fetch({ limit: 100 });

    for (const message of fetchedMessages.values()) {
      if (message.author.id === client.user.id) { // Verifica se a mensagem é do próprio bot
        try {
          await message.delete();
        } catch (err) {
          console.error(`Erro ao apagar a mensagem ${message.id}:`, err);
        }
      }
    }
  } catch (error) {
    console.error('Erro ao tentar limpar o chat:', error);
  }
}

// Função para verificar o status da live de um streamer
async function checkStream(twitchUser) {
  try {
    const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${twitchUser}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${TWITCH_ACCESS_TOKEN}`
      }
    });

    const stream = response.data.data[0];
    if (stream) {
      const userResponse = await axios.get(`https://api.twitch.tv/helix/users?login=${twitchUser}`, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${TWITCH_ACCESS_TOKEN}`
        }
      });

      const profileImageUrl = userResponse.data.data[0].profile_image_url;

      return { stream, profileImageUrl };
    }
    return null;
  } catch (error) {
    console.error('Erro ao buscar a stream:', error);
    return null;
  }
}

// Função para verificar as lives da Twitch periodicamente
async function checkTwitchStreams() {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  liveStreamers = [];

  try {
    for (const twitchUser of TWITCH_USERS) {
      const streamData = await checkStream(twitchUser);

      if (streamData) {
        const { stream, profileImageUrl } = streamData;
        const thumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225');

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

        liveStreamers.push(twitchUser);
      }
    }

    // Remover notificações antigas de streamers que não estão mais ao vivo
    for (const [twitchUser, { liveMessage }] of monitoredStreams.entries()) {
      if (!liveStreamers.includes(twitchUser)) {
        await liveMessage.delete();
        monitoredStreams.delete(twitchUser);
      }
    }

    // Atualizar o status do bot
    if (liveStreamers.length > 0) {
      client.user.setActivity(`Observando ${liveStreamers.length} streamer(s) ao vivo`, { type: 'WATCHING' });
    } else {
      client.user.setActivity('Nada ao vivo no momento', { type: 'WATCHING' });
    }
  } catch (error) {
    console.error('Erro ao verificar as streams, limpando o chat e tentando novamente:', error);

    // Limpar o chat
    await clearChat(channel);

    // Reenviar quem está ao vivo
    setTimeout(checkTwitchStreams, 5000);
  }
}

client.once('ready', () => {
  console.log('Bot está online!');

  // Verificar lives periodicamente
  setInterval(checkTwitchStreams, 5 * 60 * 1000); // Verifica a cada 5 minutos
});

client.login(process.env.DISCORD_TOKEN);
