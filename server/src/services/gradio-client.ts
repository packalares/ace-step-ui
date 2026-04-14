/**
 * Gradio client — REMOVED. Using ACE-Step FastAPI directly.
 * This file kept for import compatibility.
 */

export async function getGradioClient(): Promise<never> {
  throw new Error('Gradio client removed. Using ACE-Step FastAPI.');
}

export function resetGradioClient(): void {}

export async function isGradioAvailable(): Promise<boolean> {
  // Delegate to ACE-Step health check
  try {
    const response = await fetch('http://localhost:8000/health', {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
