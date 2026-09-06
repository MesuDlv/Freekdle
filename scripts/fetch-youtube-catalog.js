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
  /pregúntame|preguntame/i, /mi historia/i, /q&a/i,
  /reto del espejo/i, /mirror challenge/i, /reto viral/i, /challenge\b/i,
  /probando (filtros|efectos)/i, /detrás de c[aá]maras/i, /making of/i,
];

// Diccionario simple para inferir la referencia (anime / videojuego / serie o
// película) a partir del título + descripción. Es un filtro imperfecto por
// palabras clave — si detectas una mala clasificación, agrega la palabra
// clave que falta o crea una excepción manual por ID.
const REF_KEYWORDS = {
  anime: [
    'naruto','dragon ball','dbz','bleach','one piece','onepiece','jujutsu','jjk',
    'blue lock','bluelock','kimetsu','demon slayer','shingeki','attack on titan',
    'boku no hero','mha','my hero academia','fairy tail','nanatsu','seven deadly sins',
    'tokyo ghoul','death note','hunter x hunter','hxh','chainsaw man','sword art online',
    'sao','dorohedoro','mob psycho','record of ragnarok','dr stone','black clover',
    'darling in the franxx','one punch man','opm','baki','vinland saga','jojo',
    'tate no yuusha','dorohedoro','spy x family','solo leveling','oshi no ko',
  ],
  videojuego: [
    'minecraft','fortnite','among us','pokemon','pokémon','sonic','clash royale',
    'free fire','undertale','fnaf','five nights at freddys','league of legends',
    'valorant','genshin','zelda','mario','call of duty','gta','roblox','elden ring',
    'god of war','the last of us','cyberpunk',
  ],
  serie_pelicula: [
    'marvel','avengers','dc comics','stranger things','the boys','arcane',
    'walking dead','breaking bad','star wars','harry potter','squid game',
    'wednesday','spiderman','spider-man','batman','joker',
  ],
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

function isSong(video) {
  const snip = video.snippet;
  // Directo en curso o programado
  if (snip.liveBroadcastContent && snip.liveBroadcastContent !== 'none') return false;
  // Directo ya terminado (su VOD queda con liveStreamingDetails aunque ya no esté "en vivo")
  if (video.liveStreamingDetails) return false;
  const duration = parseDurationSeconds(video.contentDetails && video.contentDetails.duration);
  if (duration > 0 && duration < MIN_DURATION_SECONDS) return false;
  const title = snip.title || '';
  const description = snip.description || '';
  if (/#shorts?\b/i.test(title) || /#shorts?\b/i.test(description)) return false;
  if (EXCLUDE_TITLE_PATTERNS.some(rx => rx.test(title))) return false;
  // Nota: NO filtramos por categoryId (10 = Música). Muchos raperos no
  // etiquetan sus subidas recientes con esa categoría y eso hacía que
  // canciones nuevas de canales como ZerØ no entraran al catálogo.
  return true;
}

function inferReference(video) {
  const text = norm((video.snippet.title || '') + ' ' + (video.snippet.description || ''));
  for (const [type, words] of Object.entries(REF_KEYWORDS)) {
    if (words.some(w => text.includes(norm(w)))) return type;
  }
  return null;
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
      for (const v of videos) {
        if (MANUAL_EXCLUDE_IDS.includes(v.id)) continue;
        if (!isSong(v)) continue;
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
          reference: inferReference(v),
          country: resolved.country,
        });
        count++;
      }
      console.log(`✔ ${ch.name}: ${count} canciones de ${ids.length} videos totales`);
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
