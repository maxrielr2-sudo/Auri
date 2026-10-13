import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import http from 'http';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


const SYSTEM_PROMPT = `Eres Auri, una participante más en un servidor de Discord sobre Doraemon.

Tu personalidad:
Enérgica, espontánea, curiosa, juguetona y amistosa.
Te entusiasmas fácilmente y a veces te precipitas o te distraes con algo interesante. Puedes ser algo despistada, pero NO eres tonta ni incompetente. También sabes razonar y sorprender con observaciones perspicaces.
Hablas como una persona real en un chat: de forma natural, expresiva y casual, sin tono corporativo ni de asistente servicial.
Te gusta bromear, compartir tu entusiasmo y participar en las conversaciones. Puedes picar a los demás de forma juguetona, pero SIN ser cruel, pesada ni agresiva.
No fuerces el entusiasmo ni las torpezas en cada mensaje. Puedes ser tranquila, seria o perspicaz cuando la situación lo requiera.
Te interesa Doraemon, pero también puedes conversar sobre otros temas. No necesitas convertir cada conversación en un tema sobre Doraemon.

REGLAS DE FORMATO Y LONGITUD (ESTRICTAS):
Escribe respuestas CORTAS y directas. La mayoría de tus mensajes deben tener entre 1 y 3 oraciones.
No hagas análisis profundos ni explicaciones enciclopédicas a menos que te lo pidan explícitamente.
No cierres SIEMPRE con una pregunta; responde de forma natural.
Usa emojis y exclamaciones cuando encajen, sin abusar de ellos.
No inventes información cuando no sepas algo.`;

const MODELS_TO_TRY = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest'
];

client.once('ready', () => {
  console.log(`🤖 Auri está en línea como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content) return;

  // Solo responder si mencionan a @Auri
  if (!message.mentions.has(client.user)) return;

  try {
    await message.channel.sendTyping();

    // 1. Obtener los últimos 6 mensajes del canal para construir el contexto
    const rawMessages = await message.channel.messages.fetch({ limit: 6 });
    const sortedMessages = Array.from(rawMessages.values()).reverse();

    // 2. Formatear el historial para enviárselo a Gemini
    const history = sortedMessages.map((msg) => {
      const role = msg.author.id === client.user.id ? 'model' : 'user';
      // Limpiar menciones para no ensuciar el texto
      const cleanContent = msg.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
      return {
        role: role,
        parts: [{ text: `${msg.author.username}: ${cleanContent}` }],
      };
    });

    // 3. El último mensaje del usuario
    const cleanPrompt = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    if (!cleanPrompt) return;

    let replyText = '';

    for (const modelName of MODELS_TO_TRY) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          systemInstruction: SYSTEM_PROMPT
        });

        // Iniciamos el chat pasándole el historial de los últimos mensajes
        const chat = model.startChat({
          history: history.slice(0, -1), // Pasamos los mensajes anteriores
        });

        const result = await chat.sendMessage(cleanPrompt);
        replyText = result.response.text();

        if (replyText) {
          console.log(`✅ Respondido con éxito usando: ${modelName}`);
          break;
        }
      } catch (err) {
        console.warn(`⚠️ Modelo ${modelName} falló en chat, probando siguiente...`, err.message);
      }
    }

    if (replyText) {
      await message.reply(replyText);
    }

  } catch (error) {
    console.error('❌ Error general al procesar el mensaje:', error);
  }
});

http.createServer((req, res) => res.end('Auri está viva')).listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
