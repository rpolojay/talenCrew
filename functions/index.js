const functions = require('@google-cloud/functions-framework');

functions.http('whatsappWebhook', (req, res) => {
  // CORS Headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Your bot logic goes here
  res.status(200).send({ reply: "TalenCrew Bot is active!" });
});