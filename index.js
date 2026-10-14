import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import http from 'http';
import 'dotenv/config';

// ========================================
// CONFIGURACIÓN DE DISCORD
// ========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ========================================
// CONFIGURACIÓN DE GEMINI
// ========================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ========================================
// PERSONALIDAD DE AURI
// ========================================

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

// ========================================
// MODELOS Y TIEMPO LÍMITE
// ========================================

const MODELS_TO_TRY = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest',
];

const GEMINI_TIMEOUT_MS = 30000;

// ========================================
// EVENTO: AURI ESTÁ EN LÍNEA
// ========================================

client.once('ready', () => {
  console.log(`🤖 Auri está en línea como ${client.user.tag}`);
});

// ========================================
// EVENTO: RECEPCIÓN DE MENSAJES
// ========================================

client.on('messageCreate', async (message) => {
  console.log(
    `📩 Mensaje recibido: autor=${message.author.tag}, ` +
    `bot=${message.author.bot}, canal=${message.channel.id}`
  );

  // Ignorar mensajes de bots y mensajes vacíos.
  if (message.author.bot || !message.content) {
    return;
  }

  // Solo responder cuando mencionen a Auri.
  if (!client.user || !message.mentions.has(client.user)) {
    return;
  }

  console.log('🎯 Mención de Auri detectada.');

  try {
    // ========================================
    // INDICADOR DE ESCRITURA
    // ========================================

    await message.channel.sendTyping();

    console.log('⌨️ Indicador de escritura enviado.');

    // ========================================
    // PREPARAR EL HISTORIAL
    // ========================================

    console.log('📚 Recuperando historial del canal...');

    const rawMessages = await message.channel.messages.fetch({
      limit: 6,
    });

    const sortedMessages = Array.from(rawMessages.values())
      .filter((msg) => msg.id !== message.id)
      .reverse();

    // Convertir los mensajes de Discord al formato de Gemini.
    const history = sortedMessages
      .map((msg) => {
        const role =
          msg.author.id === client.user.id ? 'model' : 'user';

        const cleanContent = msg.content
          .replace(
            new RegExp(`<@!?${client.user.id}>`, 'g'),
            ''
          )
          .trim();

        // Ignorar mensajes vacíos después de limpiar menciones.
        if (!cleanContent) {
          return null;
        }

        return {
          role,
          parts: [
            {
              text: `${msg.author.username}: ${cleanContent}`,
            },
          ],
        };
      })
      .filter(Boolean);

    // Gemini requiere que el historial comience con un mensaje user.
    while (history.length > 0 && history[0].role !== 'user') {
      history.shift();
    }

    // Agrupar mensajes consecutivos del mismo rol.
    const normalizedHistory = [];

    for (const item of history) {
      const previous =
        normalizedHistory[normalizedHistory.length - 1];

      if (previous && previous.role === item.role) {
        previous.parts[0].text += '\n' + item.parts[0].text;
      } else {
        normalizedHistory.push({
          role: item.role,
          parts: item.parts.map((part) => ({ ...part })),
        });
      }
    }

    // ========================================
    // PREPARAR EL MENSAJE ACTUAL
    // ========================================

    const cleanPrompt = message.content
      .replace(
        new RegExp(`<@!?${client.user.id}>`, 'g'),
        ''
      )
      .trim();

    if (!cleanPrompt) {
      console.log(
        '⏭️ La mención no contiene texto después de limpiarla.'
      );

      return;
    }

    console.log('✅ Historial preparado.');
    console.log('🧠 Comenzando las peticiones a Gemini...');

    // ========================================
    // CONSULTAR LOS MODELOS
    // ========================================

    let replyText = '';

    for (const modelName of MODELS_TO_TRY) {
      console.log(`🔄 Probando modelo: ${modelName}`);

      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: SYSTEM_PROMPT,
        });

        const chat = model.startChat({
          history: normalizedHistory,
        });

        let timeoutId;

        try {
          // Limitar el tiempo de espera de cada petición.
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(
                new Error(
                  `Tiempo límite de ${
                    GEMINI_TIMEOUT_MS / 1000
                  } segundos superado`
                )
              );
            }, GEMINI_TIMEOUT_MS);
          });

          const result = await Promise.race([
            chat.sendMessage(cleanPrompt),
            timeoutPromise,
          ]);

          replyText = result.response.text();
        } finally {
          clearTimeout(timeoutId);
        }

        if (replyText) {
          console.log(
            `✅ Gemini respondió usando: ${modelName}`
          );

          break;
        }

        console.warn(
          `⚠️ ${modelName} devolvió una respuesta vacía.`
        );
      } catch (error) {
        console.error(
          `❌ Falló el modelo ${modelName}:`,
          error.message
        );
      }
    }

    // ========================================
    // ENVIAR LA RESPUESTA A DISCORD
    // ========================================

    if (replyText) {
      console.log('📤 Enviando respuesta a Discord...');

      await message.reply(replyText);

      console.log('✅ Respuesta enviada correctamente.');
    } else {
      console.error(
        '❌ Ningún modelo produjo una respuesta válida.'
      );

      await message.reply(
        'Se me ha atascado un engranaje. Dame un momento y vuelve a intentarlo. 😵‍💫'
      );

      console.log(
        '📤 Enviado mensaje indicando que hubo un problema.'
      );
    }
  } catch (error) {
    console.error(
      '❌ Error general al procesar el mensaje:',
      error
    );
  }
});

// ========================================
// SERVIDOR HTTP PARA EL ALOJAMIENTO
// ========================================

http
  .createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
    });

    res.end('Auri está viva');
  })
  .listen(process.env.PORT || 3000, () => {
    console.log('🌐 Servidor HTTP iniciado.');
  });

// ========================================
// INICIAR SESIÓN EN DISCORD
// ========================================

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error(
    '❌ Error al iniciar sesión en Discord:',
    error
  );
});
