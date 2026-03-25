import { LLMProvider, LLMRequest, LLMResponse, LLMProviderConfig } from '../../types/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'OpenAIProvider' });

export class OpenAIProvider implements LLMProvider {
  name = 'openai' as const;

  async callLLM(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse> {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    messages.push(...request.messages);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.modelName,
          messages,
          temperature: request.temperature ?? config.temperature,
          max_tokens: request.maxTokens ?? config.maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API Error ${response.status}: ${errText}`);
      }

      const data = await response.json() as any;
      const choice = data.choices?.[0];

      return {
        content: choice?.message?.content || '',
        provider: 'openai',
        model: config.modelName,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
        finishReason: choice?.finish_reason,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async isAvailable(config: LLMProviderConfig): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const openaiProvider = new OpenAIProvider();
