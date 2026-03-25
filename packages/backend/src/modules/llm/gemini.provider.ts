import { LLMProvider, LLMRequest, LLMResponse, LLMProviderConfig } from '../../types/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'GeminiProvider' });

export class GeminiProvider implements LLMProvider {
  name = 'gemini' as const;

  async callLLM(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      // Build Gemini API contents format
      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

      // System instruction is separate in Gemini
      const systemInstruction = request.systemPrompt ? { parts: [{ text: request.systemPrompt }] } : undefined;

      for (const msg of request.messages) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelName}:generateContent?key=${config.apiKey}`;

      const body: any = {
        contents,
        generationConfig: {
          temperature: request.temperature ?? config.temperature,
          maxOutputTokens: request.maxTokens ?? config.maxTokens,
        },
      };

      if (systemInstruction) {
        body.systemInstruction = systemInstruction;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API Error ${response.status}: ${errText}`);
      }

      const data = await response.json() as any;
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text || '';

      return {
        content: text,
        provider: 'gemini',
        model: config.modelName,
        usage: data.usageMetadata ? {
          promptTokens: data.usageMetadata.promptTokenCount || 0,
          completionTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0,
        } : undefined,
        finishReason: candidate?.finishReason,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async isAvailable(config: LLMProviderConfig): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const geminiProvider = new GeminiProvider();
