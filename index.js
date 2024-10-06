const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const app = express();
const PORT = 3000;
const TWITCH_USER_IDS = process.env.TWITCH_USER_ID.split(','); // Converte a string em um array
const monitoredStreams = new Map();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

app.use(express.json());

client.once('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    subscribeToTwitchWebhooks();
});

app.post('/webhook/twitch', (req, res) => {
    const { data } = req.body;

    if (data && data[0]) {
        const userId = data[0].user_id;
        const streamTitle = data[0].title;
        const profileImageUrl = data[0].profile_image_url; // URL da imagem do perfil
        const thumbnailUrl = data[0].thumbnail_url.replace('{width}', '400').replace('{height}', '225'); // Miniatura da stream em 400x225

        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        
        if (monitoredStreams.has(userId)) {
            const liveMessage = monitoredStreams.get(userId);
            liveMessage.edit({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`${streamTitle} está ao vivo!`)
                        .setURL(`https://twitch.tv/${userId}`)
                        .setThumbnail(profileImageUrl)
                        .setImage(thumbnailUrl)
                        .setColor('#9146FF') // Cor roxa da Twitch
                        .setFooter({ text: 'Clique no título para assistir à live' })
                ]
            });
        } else {
            const liveMessage = channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`${streamTitle} está ao vivo!`)
                        .setURL(`https://twitch.tv/${userId}`)
                        .setThumbnail(profileImageUrl)
                        .setImage(thumbnailUrl)
                        .setColor('#9146FF') // Cor roxa da Twitch
                        .setFooter({ text: 'Clique no título para assistir à live' })
                ]
            });
            monitoredStreams.set(userId, liveMessage);
        }
    }
    res.status(200).send('OK');
});

async function subscribeToTwitchWebhooks() {
    for (const twitchUserId of TWITCH_USER_IDS) {
        await axios.post('https://api.twitch.tv/helix/webhooks/hub', {
            "hub.callback": `${process.env.SERVER_URL}/webhook/twitch`,
            "hub.mode": "subscribe",
            "hub.topic": `https://api.twitch.tv/helix/streams?user_id=${twitchUserId}`,
            "hub.lease_seconds": 864000, // A assinatura expira em 10 dias
            "hub.secret": process.env.WEBHOOK_SECRET
        }, {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        }).catch(err => console.error(`Failed to subscribe to user ${twitchUserId}:`, err));
    }
}

client.login(process.env.DISCORD_BOT_TOKEN);
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
