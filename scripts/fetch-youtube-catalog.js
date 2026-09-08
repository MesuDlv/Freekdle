// scripts/fetch-youtube-catalog.js
//
// Genera data/youtube-catalog.json a partir de la YouTube Data API v3.
// Se ejecuta UNA VEZ por actualización (manual o vía GitHub Action programada),
// NUNCA desde el navegador del visitante: así no se gasta cuota por cada
// visita y la API key nunca queda expuesta en el frontend.
//
// Uso local:
//   YOUTUBE_API_KEY=tu_clave node scripts/fetch-youtube-catalog.js
//
// Requiere Node 18+ (usa fetch nativo).

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.error('Falta la variable de entorno YOUTUBE_API_KEY.');
  process.exit(1);
}

const BASE = 'https://www.googleapis.com/youtube/v3';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'youtube-catalog.json');

// ---------------------------------------------------------------------------
// Canales, organizados por liga. type: 'id' | 'handle' | 'username'
// group: 'bds' | 'lns' | 'rapperland' | null (null = no pertenece a ninguna liga)
// ---------------------------------------------------------------------------
const CHANNELS = [
  // Rapperland (canal principal: Keyto)
  { key: 'keyto',      name: 'Keyto',      group: 'rapperland', type: 'handle', value: 'KeytoOficial' },
  { key: 'nyako',      name: 'Nyako',      group: 'rapperland', type: 'id',     value: 'UCDGGtGObzluBVG0kZIL-XYA' },
  { key: 'zero',       name: 'ZerØ',       group: 'rapperland', type: 'handle', value: 'ZerOFreek' },
  { key: 'alice',      name: 'Alice',      group: 'rapperland', type: 'handle', value: 'LightningRoseDoll' },
  { key: 'neithanmc',  name: 'NeithanMc',  group: 'rapperland', type: 'handle', value: 'NeithanMc' },
  { key: 'zander',     name: 'Zander',     group: 'rapperland', type: 'handle', value: 'ZanDeRMusic.' },

  // BDS (canal principal: MegaR)
  { key: 'megar',      name: 'MegaR',      group: 'bds', type: 'handle', value: 'MegaRMusic' },
  { key: 'kballero',   name: 'Kballero',   group: 'bds', type: 'id',     value: 'UCuq7bERpDCTiFjAmgz6nfuw' },
  { key: 'carraxx',    name: 'CarRaxX',    group: 'bds', type: 'id',     value: 'UCwr5YC2GOUsg4phdEbuR-iQ' },
  { key: 'kyba',       name: 'Kyba',       group: 'bds', type: 'handle', value: 'KybaRap' },
  { key: 'soul',       name: 'Soul',       group: 'bds', type: 'handle', value: 'SoulRap' },
  { key: 'byn',        name: 'Byn',        group: 'bds', type: 'handle', value: 'BynMc.' },
  { key: 'darckstar',  name: 'DarckStar',  group: 'bds', type: 'id',     value: 'UCbneww7xrmljaIyUIClcfhg' },
  { key: 'bendercat',  name: 'BenderCat',  group: 'bds', type: 'handle', value: 'BenderCatRap' },

  // LNS (canal principal: Lucksterr)
  { key: 'lucksterr',  name: 'Lucksterr',  group: 'lns', type: 'id',     value: 'UCzbFXTN8AsykaQntss-P29Q' },
  { key: 'dexuz',      name: 'Dexuz',      group: 'lns', type: 'handle', value: 'DexuzOfficial' },
  { key: 'kenn',       name: 'Kenn',       group: 'lns', type: 'handle', value: 'KennRapp' },
  { key: 'ashura',     name: 'Ashura',     group: 'lns', type: 'handle', value: 'AshuraGeek' },

  // Sin liga (no son de BDS / LNS / Rapperland)
  { key: 'kapo',       name: 'Kapo',       group: null, type: 'handle',  value: 'KapoGeek' },
  { key: 'doblecero',  name: 'Doble Cero', group: null, type: 'username', value: 'ckanzeer' },
];

// Lista manual de bloqueo por ID de video: para videos que la API categoriza
// como canción pero en realidad no lo son, o que se atribuyen a un canal por
// error. Agrega aquí { id: 'VIDEO_ID', reason: '...' } si detectas un caso así.
const MANUAL_EXCLUDE_IDS = [
  // { id: 'xxxxxxxxxxx', reason: 'ejemplo' }
].map(x => x.id);

// Patrones de título que casi nunca son canciones (vlogs, anuncios, en vivo,
// resúmenes, covers de openings ajenos, etc.) — filtro de respaldo además de
// la duración mínima y la detección de directos/#shorts.
const EXCLUDE_TITLE_PATTERNS = [
  /gracias a todos/i, /muchas gracias/i, /\ben vivo\b/i, /\blive\b/i, /q *& *a/i,
  /reacciona(ndo)?\b/i, /vlog/i, /an[uú]ncio/i, /bot[oó]n de oro/i,
  /cerraron mi canal/i, /me devolvieron/i, /golden play/i, /\bteaser\b/i,
  /especial \d+ ?k/i, /lo mejor del/i, /\btop \d+\b/i, /ranking/i,
  /opening.*espa[ñn]ol latino/i, /cover.*opening/i, /unboxing/i, /haul\b/i,
  /pregúntame|preguntame/i, /q&a/i,
  /reto del espejo/i, /mirror challenge/i, /reto viral/i,
  /probando (filtros|efectos)/i, /detrás de c[aá]maras/i, /making of/i,
];

// Diccionario simple para inferir la referencia (anime / videojuego / serie o
// película) a partir del título + descripción. Es un filtro imperfecto por
// palabras clave — si detectas una mala clasificación, agrega la palabra
// clave que falta o crea una excepción manual por ID.
// NOTA sobre falsos positivos: evitamos alias muy cortos o genéricos (ej. "ace",
// "gon", "l") porque después de quitar espacios pueden aparecer por accidente
// dentro de palabras normales en español ("hace", "dragon", etc.) y generar
// una franquicia incorrecta. Priorizamos nombres largos y específicos.
const REF_KEYWORDS = {
  anime: {
    'naruto':'Naruto', 'sasuke':'Naruto', 'kakashi':'Naruto', 'boruto':'Naruto', 'itachi uchiha':'Naruto',
    'dragon ball':'Dragon Ball', 'dbz':'Dragon Ball Z', 'goku':'Dragon Ball', 'vegeta':'Dragon Ball', 'freezer':'Dragon Ball', 'frieza':'Dragon Ball',
    'bleach':'Bleach', 'ichigo kurosaki':'Bleach',
    'one piece':'One Piece', 'onepiece':'One Piece', 'monkey d luffy':'One Piece', 'roronoa zoro':'One Piece',
    'jujutsu':'Jujutsu Kaisen', 'jjk':'Jujutsu Kaisen', 'satoru gojo':'Jujutsu Kaisen', 'sukuna':'Jujutsu Kaisen', 'yuji itadori':'Jujutsu Kaisen', 'megumi fushiguro':'Jujutsu Kaisen',
    'blue lock':'Blue Lock', 'bluelock':'Blue Lock', 'isagi':'Blue Lock', 'bachira':'Blue Lock', 'itoshi sae':'Blue Lock', 'itoshi rin':'Blue Lock', 'seishiro nagi':'Blue Lock',
    'kimetsu':'Kimetsu no Yaiba', 'demon slayer':'Demon Slayer', 'tanjiro':'Demon Slayer', 'nezuko':'Demon Slayer', 'zenitsu':'Demon Slayer', 'inosuke':'Demon Slayer', 'muzan kibutsuji':'Demon Slayer', 'kyojuro rengoku':'Demon Slayer',
    'shingeki':'Shingeki no Kyojin', 'attack on titan':'Attack on Titan', 'eren yeager':'Attack on Titan', 'mikasa ackerman':'Attack on Titan', 'levi ackerman':'Attack on Titan',
    'boku no hero':'Boku no Hero Academia', 'mha':'My Hero Academia', 'my hero academia':'My Hero Academia', 'izuku midoriya':'My Hero Academia', 'katsuki bakugo':'My Hero Academia',
    'fairy tail':'Fairy Tail', 'natsu dragneel':'Fairy Tail', 'erza scarlet':'Fairy Tail',
    'nanatsu':'Nanatsu no Taizai', 'seven deadly sins':'Seven Deadly Sins',
    'tokyo ghoul':'Tokyo Ghoul', 'kaneki ken':'Tokyo Ghoul',
    'death note':'Death Note', 'light yagami':'Death Note', 'ryuk':'Death Note', 'l lawliet':'Death Note',
    'hunter x hunter':'Hunter x Hunter', 'hxh':'Hunter x Hunter', 'gon freecss':'Hunter x Hunter', 'killua zoldyck':'Hunter x Hunter',
    'chainsaw man':'Chainsaw Man', 'denji':'Chainsaw Man', 'makima':'Chainsaw Man', 'pochita':'Chainsaw Man',
    'sword art online':'Sword Art Online', 'sao':'Sword Art Online', 'kirito':'Sword Art Online',
    'dorohedoro':'Dorohedoro', 'mob psycho':'Mob Psycho 100',
    // Record of Ragnarok / Shuumatsu no Valkyrie — variantes de escritura y
    // personajes propios de la serie que no son ambiguos por sí solos.
    // Los dioses/humanos genéricos (Zeus, Poseidón, Thor, Buda, Hércules) se
    // manejan aparte más abajo con una regla combinada (ver rfRecordOfRagnarokCombo).
    'record of ragnarok':'Record of Ragnarok',
    'shuumatsu no valkyrie':'Record of Ragnarok', 'shumatsu no valkyrie':'Record of Ragnarok',
    'shuumatsu no valkirye':'Record of Ragnarok', 'shumatsu no valkirye':'Record of Ragnarok',
    'shuumatsu no walkure':'Record of Ragnarok', 'shumatsu no walkure':'Record of Ragnarok',
    'valkiria ragnarok':'Record of Ragnarok', 'brunhilde':'Record of Ragnarok', 'brunilda':'Record of Ragnarok',
    'sasaki kojiro':'Record of Ragnarok', 'lu bu ragnarok':'Record of Ragnarok',
    'dr stone':'Dr. Stone', 'black clover':'Black Clover', 'asta black clover':'Black Clover',
    'darling in the franxx':'Darling in the Franxx', 'one punch man':'One Punch Man', 'opm':'One Punch Man', 'saitama':'One Punch Man',
    'baki hanma':'Baki', 'yujiro hanma':'Baki', 'vinland saga':'Vinland Saga', 'thorfinn':'Vinland Saga',
    'jojo bizarre':'JoJo\'s Bizarre Adventure', 'jotaro kujo':'JoJo\'s Bizarre Adventure', 'dio brando':'JoJo\'s Bizarre Adventure',
    'tate no yuusha':'The Rising of the Shield Hero', 'spy x family':'Spy x Family', 'anya forger':'Spy x Family',
    'solo leveling':'Solo Leveling', 'sung jinwoo':'Solo Leveling', 'oshi no ko':'Oshi no Ko',
    'dandadan':'Dandadan', 'kaiju no 8':'Kaiju No. 8', 'mashle':'Mashle',
    'hells paradise':'Hell\'s Paradise', 'jigokuraku':'Hell\'s Paradise',
    'berserk':'Berserk', 'guts berserk':'Berserk', 'fullmetal alchemist':'Fullmetal Alchemist', 'edward elric':'Fullmetal Alchemist',
    'evangelion':'Neon Genesis Evangelion', 'shinji ikari':'Neon Genesis Evangelion',
    'code geass':'Code Geass', 'lelouch':'Code Geass', 're zero':'Re:Zero', 'subaru natsuki':'Re:Zero',
    'overlord anime':'Overlord', 'ainz ooal gown':'Overlord', 'konosuba':'Konosuba',
    'tensei slime':'That Time I Got Reincarnated as a Slime', 'rimuru tempest':'That Time I Got Reincarnated as a Slime',
    'toilet bound hanako':'Toilet-Bound Hanako-kun', 'kaguya sama':'Kaguya-sama: Love Is War',
    'haikyuu':'Haikyu!!', 'kuroko no basket':'Kuroko no Basket', 'inazuma eleven':'Inazuma Eleven',
    'yu gi oh':'Yu-Gi-Oh!', 'digimon':'Digimon', 'beyblade':'Beyblade', 'inuyasha':'Inuyasha',
    'fruits basket':'Fruits Basket', 'promised neverland':'The Promised Neverland', 'made in abyss':'Made in Abyss',
    'iruma kun':'Mairimashita! Iruma-kun', 'mairimashita iruma':'Mairimashita! Iruma-kun', 'iruma suzuki':'Mairimashita! Iruma-kun',
    // Series de "recopilación" que mezclan varios animes en una sola canción
    // (no pertenecen a un solo show, pero sí son claramente de anime).
    'desamor en anime':'Varios animes (recopilación)',
    'violet evergarden':'Violet Evergarden', 'assassination classroom':'Assassination Classroom', 'koro sensei':'Assassination Classroom',
    // Romcoms — género muy común entre estos raperos y que antes casi no estaba cubierto.
    'kaguya sama':'Kaguya-sama: Love Is War', 'kaguya shinomiya':'Kaguya-sama: Love Is War', 'miyuki shirogane':'Kaguya-sama: Love Is War',
    'toradora':'Toradora!', 'taiga aisaka':'Toradora!', 'ryuuji takasu':'Toradora!',
    'oregairu':'Oregairu', 'yahari ore no seishun':'Oregairu', 'hachiman hikigaya':'Oregairu',
    'horimiya':'Horimiya', 'kyoko hori':'Horimiya', 'izumi miyamura':'Horimiya',
    'tonikaku kawaii':'Tonikaku Kawaii', 'tonikawa':'Tonikaku Kawaii', 'tsukasa tonikawa':'Tonikaku Kawaii',
    'kanojo okarishimasu':'Rent-a-Girlfriend', 'rent a girlfriend':'Rent-a-Girlfriend', 'chizuru mizuhara':'Rent-a-Girlfriend',
    'nisekoi':'Nisekoi', 'chitoge kirisaki':'Nisekoi', 'raku ichijo':'Nisekoi',
    'nagatoro':"Don't Toy with Me, Miss Nagatoro",
    'komi san':"Komi Can't Communicate", 'komi shouko':"Komi Can't Communicate",
    'sono bisque doll':'My Dress-Up Darling', 'dress up darling':'My Dress-Up Darling', 'marin kitagawa':'My Dress-Up Darling',
    'uzaki chan':'Uzaki-chan Wants to Hang Out!',
    'wotakoi':'Wotakoi', 'wotaku ni koi':'Wotakoi',
    'domestic na kanojo':'Domestic Girlfriend', 'domestic girlfriend':'Domestic Girlfriend',
    'couple of cuckoos':'A Couple of Cuckoos',
    'yabai yatsu':'The Dangers in My Heart', 'dangers in my heart':'The Dangers in My Heart', 'kyoutarou ichikawa':'The Dangers in My Heart',
    'tomo chan wa onnanoko':'Tomo-chan Is a Girl!',
    'shikimori':"Shikimori's Not Just a Cutie",
    'yamada kun to 7 nin':'Yamada-kun and the Seven Witches',
    'kimi ni todoke':'Kimi ni Todoke', 'sawako kuronuma':'Kimi ni Todoke',
    'gotoubun no hanayome':'The Quintessential Quintuplets', 'quintessential quintuplets':'The Quintessential Quintuplets', 'nakano itsuki':'The Quintessential Quintuplets',
    'kanokari':'Rent-a-Girlfriend', 'oshi no ko ai':'Oshi no Ko',
  },
  videojuego: {
    'minecraft':'Minecraft', 'fortnite':'Fortnite', 'among us':'Among Us', 'pokemon':'Pokémon', 'pokémon':'Pokémon',
    'sonic the hedgehog':'Sonic', 'sonic':'Sonic', 'clash royale':'Clash Royale', 'free fire':'Free Fire', 'undertale':'Undertale', 'sans undertale':'Undertale',
    'fnaf':'Five Nights at Freddy\'s', 'five nights at freddys':'Five Nights at Freddy\'s', 'freddy fazbear':'Five Nights at Freddy\'s',
    'league of legends':'League of Legends', 'valorant':'Valorant', 'genshin impact':'Genshin Impact',
    'legend of zelda':'Zelda', 'zelda':'Zelda', 'super mario':'Mario', 'call of duty':'Call of Duty',
    'grand theft auto':'GTA', 'gta':'GTA', 'roblox':'Roblox',
    'elden ring':'Elden Ring', 'god of war':'God of War', 'the last of us':'The Last of Us',
    'cyberpunk 2077':'Cyberpunk 2077', 'cyberpunk':'Cyberpunk 2077',
  },
  serie_pelicula: {
    'marvel':'Marvel', 'avengers':'Avengers', 'dc comics':'DC Comics', 'stranger things':'Stranger Things',
    'the boys':'The Boys', 'arcane':'Arcane', 'walking dead':'The Walking Dead', 'breaking bad':'Breaking Bad',
    'star wars':'Star Wars', 'harry potter':'Harry Potter', 'squid game':'Squid Game', 'wednesday addams':'Wednesday',
    'spiderman':'Spider-Man', 'spider-man':'Spider-Man', 'batman':'Batman', 'joker':'Joker',
  },
};

// Nombres de dioses/humanos de Record of Ragnarok que son demasiado genéricos
// para mapearse solos (Zeus, Poseidón, etc. se usan en mil contextos que no
// tienen nada que ver con el anime). Solo cuentan como Record of Ragnarok si
// aparecen JUNTO a alguna otra palabra propia de la serie (ragnarok, valkyrie,
// valkiria, dioses vs humanos) en el mismo título/descripción — sin importar
// el orden ni si están separados por otras palabras.
const RAGNAROK_GENERIC_NAMES = ['zeus', 'poseidon', 'poseidón', 'thor', 'hercules', 'hércules', 'buda', 'adan', 'adán', 'shiva', 'jack the ripper'];
const RAGNAROK_CONTEXT_WORDS = ['ragnarok', 'valkyrie', 'valkiria', 'shuumatsu', 'shumatsu'];
function isRecordOfRagnarokByContext(text) {
  const hasGenericGod = RAGNAROK_GENERIC_NAMES.some(n => text.includes(norm(n)));
  const hasContext = RAGNAROK_CONTEXT_WORDS.some(w => text.includes(norm(w)));
  return hasGenericGod && hasContext;
}

// Corrección manual por video: para cuando el detector automático de
// franquicia se equivoca en un caso puntual (anime poco conocido que no está
// en el diccionario, título ambiguo, etc). Agrega aquí el ID del video con la
// categoría ('anime' | 'videojuego' | 'serie_pelicula') y el nombre exacto que
// quieres que aparezca como pregunta en el juego. Ejemplo:
//   'dQw4w9WgXcQ': { category: 'anime', franchise: 'Mashle' },
// Si el video SÍ es original (no basado en nada), pon franchise: null.
const MANUAL_FRANCHISE_OVERRIDES = {
  // 'VIDEO_ID': { category: 'anime', franchise: 'Nombre del anime' },
};

// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function norm(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
}

async function apiGet(endpoint, params) {
  const qs = new URLSearchParams({ ...params, key: API_KEY }).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`${endpoint} error: ${JSON.stringify(data.error.errors || data.error)}`);
  }
  return data;
}

async function resolveChannel(ch) {
  let params;
  if (ch.type === 'id') params = { id: ch.value };
  else if (ch.type === 'handle') params = { forHandle: ch.value };
  else params = { forUsername: ch.value };
  const data = await apiGet('channels', { part: 'contentDetails,snippet', ...params });
  const item = data.items && data.items[0];
  if (!item) throw new Error(`No se encontró el canal de ${ch.name} (${ch.type}=${ch.value})`);
  return {
    channelId: item.id,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    country: item.snippet.country || null,
  };
}

async function getAllVideoIds(playlistId) {
  let ids = [];
  let pageToken = '';
  do {
    const data = await apiGet('playlistItems', {
      part: 'contentDetails', maxResults: '50', playlistId, pageToken,
    });
    (data.items || []).forEach(it => ids.push(it.contentDetails.videoId));
    pageToken = data.nextPageToken || '';
    await sleep(60);
  } while (pageToken);
  return ids;
}

// La playlist especial "uploads" de un canal a veces deja de reflejar los
// videos más recientes (bug conocido de la API de YouTube en canales activos).
// Como respaldo, siempre traemos también los últimos 50 videos vía search.list
// ordenados por fecha, y los combinamos con lo anterior sin duplicar.
async function getRecentVideoIdsViaSearch(channelId) {
  try {
    const data = await apiGet('search', {
      part: 'id', channelId, order: 'date', type: 'video', maxResults: '50',
    });
    return (data.items || []).map(it => it.id && it.id.videoId).filter(Boolean);
  } catch (e) {
    console.error('  (aviso) search.list de respaldo falló:', e.message);
    return [];
  }
}

async function getVideosDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await apiGet('videos', { part: 'snippet,statistics,contentDetails,liveStreamingDetails', id: chunk.join(',') });
    out.push(...(data.items || []));
    await sleep(60);
  }
  return out;
}

// Convierte una duración ISO 8601 (ej. "PT1M32S") a segundos totales.
function parseDurationSeconds(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + s;
}

const MIN_DURATION_SECONDS = 60; // descarta shorts/teasers/intros muy cortos
// Un video "estrenado" (premiere) en YouTube también trae liveStreamingDetails,
// aunque sea simplemente la canción normal con chat en vivo durante el estreno.
// Solo tratamos como DIRECTO real algo con liveStreamingDetails Y una duración
// larga (más de lo que dura una canción) — así no perdemos canciones estrenadas
// como premiere, que es una práctica muy común entre estos raperos.
const LIVE_MIN_DURATION_TO_EXCLUDE = 600; // 10 minutos

function getExcludeReason(video) {
  const snip = video.snippet;
  if (snip.liveBroadcastContent && snip.liveBroadcastContent !== 'none') return 'en_vivo_ahora';
  const duration = parseDurationSeconds(video.contentDetails && video.contentDetails.duration);
  if (video.liveStreamingDetails && duration > LIVE_MIN_DURATION_TO_EXCLUDE) return 'directo_largo';
  if (duration > 0 && duration < MIN_DURATION_SECONDS) return 'muy_corto';
  const title = snip.title || '';
  const description = snip.description || '';
  if (/#shorts?\b/i.test(title) || /#shorts?\b/i.test(description)) return 'hashtag_shorts';
  const matchedPattern = EXCLUDE_TITLE_PATTERNS.find(rx => rx.test(title));
  if (matchedPattern) return 'patron_titulo:' + matchedPattern;
  return null;
}
function isSong(video) { return getExcludeReason(video) === null; }

function inferReference(video) {
  // 1. Corrección manual explícita por ID de video — siempre gana.
  if (MANUAL_FRANCHISE_OVERRIDES[video.id]) return MANUAL_FRANCHISE_OVERRIDES[video.id];

  const text = norm((video.snippet.title || '') + ' ' + (video.snippet.description || ''));

  // 2. Regla combinada para los dioses/humanos genéricos de Record of Ragnarok.
  if (isRecordOfRagnarokByContext(text)) return { category: 'anime', franchise: 'Record of Ragnarok' };

  // 3. Diccionario normal de alias directos.
  for (const [type, dict] of Object.entries(REF_KEYWORDS)) {
    for (const [keyword, label] of Object.entries(dict)) {
      if (text.includes(norm(keyword))) return { category: type, franchise: label };
    }
  }
  return { category: null, franchise: null };
}

function bestThumbnail(thumbs) {
  return (thumbs.maxres || thumbs.high || thumbs.standard || thumbs.medium || thumbs.default || {}).url || '';
}

async function main() {
  const catalog = [];
  const missing = [];

  for (const ch of CHANNELS) {
    try {
      const resolved = await resolveChannel(ch);
      const uploadsIds = await getAllVideoIds(resolved.uploadsPlaylistId);
      const recentIds = await getRecentVideoIdsViaSearch(resolved.channelId);
      const ids = [...new Set([...uploadsIds, ...recentIds])];
      const videos = await getVideosDetails(ids);
      let count = 0;
      const reasonCounts = {};
      for (const v of videos) {
        if (MANUAL_EXCLUDE_IDS.includes(v.id)) continue;
        const reason = getExcludeReason(v);
        if (reason) { reasonCounts[reason] = (reasonCounts[reason] || 0) + 1; continue; }
        const ref = inferReference(v);
        catalog.push({
          id: v.id,
          title: v.snippet.title,
          description: v.snippet.description || '',
          thumbnail: bestThumbnail(v.snippet.thumbnails || {}),
          channelKey: ch.key,
          channelName: ch.name,
          group: ch.group,
          views: parseInt((v.statistics && v.statistics.viewCount) || '0', 10),
          durationSeconds: parseDurationSeconds(v.contentDetails && v.contentDetails.duration),
          publishedAt: v.snippet.publishedAt,
          year: new Date(v.snippet.publishedAt).getFullYear(),
          url: `https://www.youtube.com/watch?v=${v.id}`,
          reference: ref.category,
          franchise: ref.franchise,
          country: resolved.country,
        });
        count++;
      }
      console.log(`✔ ${ch.name}: ${count} canciones de ${ids.length} videos totales`);
      if (ids.length && count / ids.length < 0.4) {
        const breakdown = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])
          .map(([reason, n]) => `${reason}=${n}`).join(', ');
        console.log(`   (descartados) ${breakdown}`);
      }
      if (count === 0) missing.push(ch.name);
    } catch (e) {
      console.error(`✘ Error con ${ch.name}:`, e.message);
      missing.push(ch.name);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    missing,
    videos: catalog,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`\nCatálogo guardado en ${OUTPUT_PATH} — ${catalog.length} canciones en total.`);
  if (missing.length) console.log('Canales sin canciones o con error:', missing.join(', '));
}

main().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
