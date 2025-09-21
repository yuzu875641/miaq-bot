const express = require('express');
const fetch = require('node-fetch');
const FormData = require('form-data');
const app = express();
const port = process.env.PORT || 3000;

// 環境変数からAPIトークンとボットのIDを取得
const CHATWORK_TOKEN = process.env.CHATWORK_TOKEN;
const BOT_ACCOUNT_ID = process.env.BOT_ACCOUNT_ID;

// JSON形式のボディを解析するためのミドルウェア
app.use(express.json());

// ChatworkからのWebhookを受け取るエンドポイント
app.post('/webhook', async (req, res) => {
  try {
    const senderAccountId = req.body.webhook_event.account_id;

    // --- ここに新しいチェックロジックを追加 ---
    // もしメッセージ送信者がボット自身だったら、処理を停止
    if (senderAccountId.toString() === BOT_ACCOUNT_ID.toString()) {
      console.log('Received message from the bot itself. Skipping response.');
      return res.status(200).send('Message from bot, skipping.');
    }

    const body = req.body.webhook_event.body;
    const roomId = req.body.webhook_event.room_id;

    // /miaq/ に続くURLを正規表現で抽出
    const regex = /\/miaq\/https:\/\/www\.chatwork\.com\/\#!rid\((\d+)\)-(\d+)/;
    const match = body.match(regex);

    if (!match) {
      return res.status(200).send('No /miaq/ command found.');
    }

    const targetRoomId = match[1];
    const targetMessageId = match[2];

    console.log(`Command detected. Target message: room=${targetRoomId}, message=${targetMessageId}`);

    // --- 1. Chatwork APIを使って投稿情報を取得 ---
    const chatworkMessageUrl = `https://api.chatwork.com/v2/rooms/${targetRoomId}/messages/${targetMessageId}`;
    const chatworkResponse = await fetch(chatworkMessageUrl, {
      method: 'GET',
      headers: {
        'X-ChatWorkToken': CHATWORK_TOKEN
      }
    });

    if (!chatworkResponse.ok) {
      throw new Error(`Failed to fetch message from Chatwork: ${chatworkResponse.statusText}`);
    }
    const messageData = await chatworkResponse.json();

    // --- 2. 取得した情報から画像生成APIのパラメータを準備 ---
    const params = {
      type: 'reverseColor',
      name: messageData.account.name,
      id: messageData.account.account_id,
      content: messageData.body,
      icon: messageData.account.icon_url
    };

    console.log('Parameters for image generation:', params);

    // --- 3. 画像生成APIを呼び出し ---
    const generateImageUrl = `https://miq-yol8.onrender.com/?${new URLSearchParams(params).toString()}`;
    const imageResponse = await fetch(generateImageUrl);

    if (!imageResponse.ok) {
      throw new Error('Failed to generate image from external API.');
    }

    const imageBuffer = await imageResponse.buffer();

    // --- 4. 生成した画像をChatworkにアップロード ---
    const chatworkUploadUrl = `https://api.chatwork.com/v2/rooms/${roomId}/files`;
    const form = new FormData();
    form.append('file', imageBuffer, {
      filename: 'miaq_generated.png',
      contentType: 'image/png',
    });
    form.append('message', `[To:${req.body.webhook_event.account_id}] あなたの投稿を画像にしました。`);

    const uploadResponse = await fetch(chatworkUploadUrl, {
      method: 'POST',
      headers: {
        'X-ChatWorkToken': CHATWORK_TOKEN,
        ...form.getHeaders()
      },
      body: form
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Failed to upload file to Chatwork: ${uploadResponse.status} ${errorText}`);
    }

    console.log('Image successfully uploaded to Chatwork.');
    res.status(200).send('Image generated and posted successfully.');

  } catch (error) {
    console.error('An error occurred:', error);
    res.status(500).send('An error occurred while processing the request.');
  }
});

// サーバー起動
app.listen(port, () => {
  console.log(`Chatwork bot listening at http://localhost:${port}`);
});
