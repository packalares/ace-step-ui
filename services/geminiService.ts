/**
 * Song data generation — replaces Gemini with ACE-Step's built-in LLM.
 * Uses /format_input for caption enhancement and /create_random_sample for random generation.
 * Falls back to simple template if ACE-Step API is not available.
 */

const ACESTEP_API = 'http://localhost:8000';

export const generateSongData = async (
  topic: string,
  style: string
): Promise<{ title: string; lyrics: string; tags: string[] }> => {
  try {
    // Try ACE-Step's format_input to enhance the prompt
    const response = await fetch(`${ACESTEP_API}/format_input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caption: `${style} song about ${topic}`,
        lyrics: '',
        format_caption: true,
        format_lyrics: true,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const result = data?.data || data;
      return {
        title: topic || style || 'Untitled',
        lyrics: result?.lyrics || `[Verse]\n${topic}\n\n[Chorus]\n${style}`,
        tags: style ? style.split(',').map((s: string) => s.trim()).filter(Boolean) : ['music'],
      };
    }
  } catch (error) {
    console.warn('ACE-Step format_input not available:', error);
  }

  // Fallback: simple template
  return {
    title: topic || style || 'Untitled Song',
    lyrics: `[Verse]\n${topic || 'A song about life'}\n\n[Chorus]\n${style || 'Music fills the air'}`,
    tags: style ? style.split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 3) : ['music'],
  };
};
