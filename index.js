const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// URL do Discord onde a notificação será enviada
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Inscrição em Webhook da Twitch
const subscribeToTwitchWebhook = async (twitchUserId) => {
  try {
    const response = await axios.post('https://api.twitch.tv/helix/webhooks/hub', {
      "hub.callback": `${process.env.SERVER_URL}/webhook/twitch`,
      "hub.mode": "subscribe",
      "hub.topic": `https://api.twitch.tv/helix/streams?user_id=${twitchUserId}`,
      "hub.lease_seconds": 864000, // 10 dias
      "hub.secret": process.env.WEBHOOK_SECRET
    }, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`
      }
    });

    console.log('Inscrição em Webhook realizada com sucesso:', response.data);
  } catch (error) {
    console.error('Erro ao se inscrever no Webhook:', error.response.data);
  }
};

// Endpoint que a Twitch chamará quando o streamer ficar ao vivo
app.post('/webhook/twitch', (req, res) => {
  const { data } = req.body;

  if (data && data.length > 0) {
    const stream = data[0]; // Primeiro stream da lista
    const streamerName = stream.user_name;

    const embed = {
      title: `${streamerName} está ao vivo na Twitch!`,
      url: `https://twitch.tv/${streamerName}`,
      description: `**Título**: ${stream.title}\n**Jogo**: ${stream.game_name}\n**Visualizações**: ${stream.viewer_count}`,
      color: 16711680, // Vermelho
      footer: {
        text: 'Clique no título para assistir à live'
      },
      thumbnail: {
        url: stream.thumbnail_url.replace('{width}', '400').replace('{height}', '225')
      }
    };

    // Envia mensagem para o Discord
    axios.post(DISCORD_WEBHOOK_URL, {
      content: `🔴 @everyone ${streamerName} está ao vivo!`,
      embeds: [embed]
    })
    .then(() => {
      console.log(`Notificação enviada para o Discord: ${streamerName} está ao vivo!`);
    })
    .catch(error => {
      console.error('Erro ao enviar mensagem para o Discord:', error);
    });
  }

  res.sendStatus(200); // Resposta para a Twitch
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  // Inscrever-se no Webhook da Twitch para cada streamer
  const twitchUserId = process.env.TWITCH_USER_ID; // Adicione o ID do usuário que você deseja monitorar
  subscribeToTwitchWebhook(twitchUserId);
});
