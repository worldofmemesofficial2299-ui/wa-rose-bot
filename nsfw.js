import axios from 'axios';

const API_USER = process.env.SIGHTENGINE_USER;
const API_SECRET = process.env.SIGHTENGINE_SECRET;

export async function isNSFW(mediaBuffer, mimeType) {
  if (!API_USER || !API_SECRET) {
    console.warn('⚠️ Sightengine keys missing — NSFW check skipped');
    return false;
  }

  const form = new FormData();
  form.append('media', new Blob([mediaBuffer], { type: mimeType }));
  form.append('models', 'nudity-2.1');
  form.append('api_user', API_USER);
  form.append('api_secret', API_SECRET);

  try {
    const { data } = await axios.post('https://api.sightengine.com/1.0/check.json', form, {
      timeout: 15000,
    });
    // Sightengine returns { nudity: { sexual_activity: 0.1, ... } }
    const score = data?.nudity?.sexual_activity ?? 0;
    return score >= (parseFloat(process.env.NSFW_THRESHOLD) || 0.7);
  } catch (err) {
    console.error('NSFW API error:', err.message);
    return false; // fail-open so legitimate media isn't blocked
  }
}
