const BOT_URL = 'https://us-central1-gen-lang-client-0598503352.cloudfunctions.net/talencrew-bot';

async function askBot(userQuery) {
  try {
    const response = await fetch(BOT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userQuery })
    });
    return await response.json();
  } catch (error) {
    console.error("Error:", error);
    return { reply: "Error connecting to bot." };
  }
}