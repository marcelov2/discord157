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

// Limpa o chat quando o bot desconectar
async function clearChat(channel) {
  let messages;
  do {
    messages = await channel.messages.fetch({ limit: 100 });

    // Se não houver mensagens, parar de buscar
    if (messages.size === 0) {
      break;
    }

    // Exclui as mensagens
    await channel.bulkDelete(messages).catch(error => {
      console.error('Erro ao limpar mensagens:', error);
    });

  } while (messages.size > 0);
}

// Função para verificar as lives da Twitch periodicamente
async function checkTwitchStreams() {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  liveStreamers = [];

  for (const twitchUser of TWITCH_USERS) {
    const streamData = await checkStream(twitchUser);

    // Se o streamer estiver ao vivo e não está sendo monitorado
    if (streamData && !monitoredStreams.has(twitchUser)) {
      const { stream, profileImageUrl } = streamData;
      const thumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225'); // Miniatura da stream em 400x80

      const updatedEmbed = new EmbedBuilder()
        .setTitle(`${twitchUser} está ao vivo na Twitch!`)
        .setURL(`https://twitch.tv/${twitchUser}`)
        .setDescription(`**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`)
        .setThumbnail(profileImageUrl)
        .setImage(thumbnailUrl)
        .setColor(Colors.Red)
        .setFooter({ text: 'Clique no título para assistir à live' });

      // Enviar a mensagem e armazenar no mapa de streams monitorados
      const liveMessage = await channel.send({ content: `🔴 @everyone ${twitchUser} está ao vivo!`, embeds: [updatedEmbed] });
      monitoredStreams.set(twitchUser, { liveMessage, game: stream.game_name });

      liveStreamers.push({ username: twitchUser, game: stream.game_name });
      rotatePresence(); // Atualiza a presença ao detectar um streamer ao vivo
    } 
    // Se o streamer não estiver mais ao vivo e está sendo monitorado
    else if (!streamData && monitoredStreams.has(twitchUser)) {
      const liveMessage = monitoredStreams.get(twitchUser).liveMessage;
      await liveMessage.delete(); // Exclui a mensagem assim que o streamer sair do ar
      monitoredStreams.delete(twitchUser); // Remove o streamer da lista de monitoramento
      liveStreamers = liveStreamers.filter(s => s.username !== twitchUser);
    }
  }
}

// Função para atualizar a thumbnail, jogo e contagem de visualizações das streams ao vivo
async function updateThumbnails() {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);

  for (const [twitchUser, streamInfo] of monitoredStreams.entries()) {
    const streamData = await checkStream(twitchUser);

    if (streamData) {
      const { stream, profileImageUrl } = streamData;
      const thumbnailUrl = stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225'); // Atualizar a thumbnail

      const updatedEmbed = new EmbedBuilder()
        .setTitle(`${twitchUser} está ao vivo na Twitch!`)
        .setURL(`https://twitch.tv/${twitchUser}`)
        .setDescription(`**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`)
        .setThumbnail(profileImageUrl) // Manter a mesma imagem do perfil
        .setImage(thumbnailUrl)
        .setColor(Colors.Red)
        .setFooter({ text: 'Clique no título para assistir à live' });

      await streamInfo.liveMessage.edit({ embeds: [updatedEmbed] }); // Edita a mensagem para atualizar a thumbnail, jogo e visualizações
    }
  }
}

// Função para atualizar a presença do bot
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

// Configurar o bot para escutar comandos
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'add') {
    const username = options.getString('username');

    if (TWITCH_USERS.includes(username)) {
      await interaction.reply(`${username} já está na lista.`);
    } else {
      TWITCH_USERS.push(username);
      fs.writeFileSync('.env', `TWITCH_USERS=${TWITCH_USERS.join(',')}\n`); // Atualiza o .env
      await interaction.reply(`Streamer ${username} adicionado à lista.`);
    }
  } else if (commandName === 'remove') {
    const username = options.getString('username');

    if (!TWITCH_USERS.includes(username)) {
      await interaction.reply(`${username} não está na lista.`);
    } else {
      removeTwitchUser(username);
      await interaction.reply(`Streamer ${username} removido da lista.`);
    }
  }
});

// Inicialização do bot
client.once('ready', async () => {
  console.log('Bot está online!');
  await getTwitchAccessToken(); // Obter o token de acesso ao iniciar

  // Limpa o chat quando o bot é iniciado
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  await clearChat(channel);

  checkTwitchStreams(); // Verifica as streams ativas na inicialização
  setInterval(checkTwitchStreams, 10 * 60 * 1000); // Verifica as streams a cada 10 minutos
  setInterval(updateThumbnails, 10 * 60 * 1000); // Atualiza a thumbnail, jogo e visualizações a cada 10 minutos
});

// Login no Discord
client.login(DISCORD_TOKEN);
