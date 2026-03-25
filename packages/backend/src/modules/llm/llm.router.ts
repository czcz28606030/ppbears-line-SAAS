import { LLMProvider, LLMRequest, LLMResponse, LLMProviderConfig, LLMProviderType, TenantModelConfigRow } from '../../types/index.js';
import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';
import { logSystemError } from '../../utils/audit.js';
import { openaiProvider } from './openai.provider.js';
import { geminiProvider } from './gemini.provider.js';

const log = createLogger({ module: 'LLMRouter' });

/**
 * LLM Router: resolves the correct provider for a tenant and handles fallback.
 */
export class LLMRouter {
  private providers = new Map<LLMProviderType, LLMProvider>();

  constructor() {
    this.providers.set('openai', openaiProvider);
    this.providers.set('gemini', geminiProvider);
    // Future: this.providers.set('claude', claudeProvider);
  }

  /**
   * Main entry: call LLM for a tenant with automatic fallback.
   */
  async call(tenantId: string, request: LLMRequest): Promise<LLMResponse> {
    // Get tenant's default model config
    const primaryConfig = await this.getDefaultConfig(tenantId);
    if (!primaryConfig) {
      throw new Error(`No LLM config found for tenant ${tenantId}`);
    }

    // Try primary provider
    try {
      return await this.callWithConfig(primaryConfig, request);
    } catch (primaryErr: any) {
      log.warn({ tenantId, provider: primaryConfig.provider, err: primaryErr.message }, 'Primary LLM failed');
      await logSystemError(tenantId, 'llm', `Primary LLM failed: ${primaryErr.message}`);

      // Try fallback if configured
      if (primaryConfig.fallback_config_id) {
        const fallbackConfig = await this.getConfigById(primaryConfig.fallback_config_id);
        if (fallbackConfig) {
          log.info({ tenantId, fallbackProvider: fallbackConfig.provider }, 'Attempting fallback LLM');
          try {
            return await this.callWithConfig(fallbackConfig, request);
          } catch (fallbackErr: any) {
            log.error({ tenantId, err: fallbackErr.message }, 'Fallback LLM also failed');
            await logSystemError(tenantId, 'llm', `Fallback LLM failed: ${fallbackErr.message}`);
          }
        }
      }

      throw new Error('All LLM providers failed');
    }
  }

  private async callWithConfig(
    modelConfig: TenantModelConfigRow,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const provider = this.providers.get(modelConfig.provider);
    if (!provider) {
      throw new Error(`Unknown LLM provider: ${modelConfig.provider}`);
    }

    const providerConfig: LLMProviderConfig = {
      provider: modelConfig.provider,
      modelName: modelConfig.model_name,
      apiKey: modelConfig.api_key_encrypted, // In production: decrypt
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.max_tokens,
      timeoutMs: modelConfig.timeout_ms,
      retryCount: modelConfig.retry_count,
    };

    // Retry logic
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= providerConfig.retryCount; attempt++) {
      try {
        return await provider.callLLM(request, providerConfig);
      } catch (err: any) {
        lastError = err;
        if (attempt < providerConfig.retryCount) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new Error('LLM call failed');
  }

  private async getDefaultConfig(tenantId: string): Promise<TenantModelConfigRow | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_model_configs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .eq('enabled', true)
      .single();
    return data;
  }

  private async getConfigById(configId: string): Promise<TenantModelConfigRow | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_model_configs')
      .select('*')
      .eq('id', configId)
      .eq('enabled', true)
      .single();
    return data;
  }
}

export const llmRouter = new LLMRouter();
