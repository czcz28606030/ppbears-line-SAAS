import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'TaggingService' });

/**
 * Normalizes a raw phone model string into a tag-safe slug.
 * e.g. "iPhone 16 Pro Max" → "phone:iphone-16-pro-max"
 */
function normalizeModelTag(raw: string): string {
  return 'phone:' + raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w:-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extraction rules: each entry defines a regex and how to build the display string.
 * We use named groups so we can reconstruct the canonical model name.
 */
const MODEL_PATTERNS: Array<{ brand: string; regex: RegExp }> = [
  // Apple iPhone — e.g. iPhone 16 Pro Max, iphone16pro
  {
    brand: 'iphone',
    regex: /iphone\s*(\d{1,2})\s*(pro\s*max|pro\s*plus|pro|plus|max|mini|ultra)?/gi,
  },
  // Apple iPad
  {
    brand: 'ipad',
    regex: /ipad\s*(pro|air|mini|)?\s*(\d{0,2})?\s*(m\d)?/gi,
  },
  // Samsung Galaxy S / A / Z series — e.g. Galaxy S25 Ultra, S24 FE
  {
    brand: 'samsung',
    regex: /(?:galaxy\s*)?([sz]\d{1,2}(?:\s*(?:ultra|plus|\+|fe|edge))?|a\d{2}(?:\s*(?:ultra|plus|\+|fe))?)/gi,
  },
  // Google Pixel — e.g. Pixel 9 Pro
  {
    brand: 'pixel',
    regex: /pixel\s*(\d{1,2})\s*(pro\s*xl|pro|xl|fold|a)?/gi,
  },
  // Xiaomi / Redmi / POCO
  {
    brand: 'xiaomi',
    regex: /(?:xiaomi|redmi|poco)\s*(\w+\s*\w*)/gi,
  },
  // OPPO / OnePlus / Realme
  {
    brand: 'oppo',
    regex: /(?:oppo|oneplus|realme)\s*(\w+\s*\w*)/gi,
  },
  // Vivo
  { brand: 'vivo', regex: /vivo\s*(\w+)/gi },
  // Huawei
  { brand: 'huawei', regex: /huawei\s*(\w+)/gi },
  // Sony Xperia
  { brand: 'sony', regex: /(?:sony\s*)?xperia\s*(\d+\s*(?:ii|iii|iv|v|vi)?)/gi },
  // ASUS ROG / Zenfone
  { brand: 'asus', regex: /(?:asus\s*)?(?:rog\s*phone|zenfone)\s*(\d+)/gi },
];

export class TaggingService {
  /**
   * Extract all phone model strings from a customer message.
   * Returns a deduplicated array of normalized tag slugs.
   * e.g. ["phone:iphone-16-pro-max", "phone:samsung-s25-ultra"]
   */
  extractPhoneModels(text: string): string[] {
    const found = new Set<string>();

    for (const { brand, regex } of MODEL_PATTERNS) {
      // Reset lastIndex for global regexes
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        // Reconstruct full model string from match
        const full = match[0].trim();
        if (full.length >= 2) {
          found.add(normalizeModelTag(full));
        }
      }
    }

    return Array.from(found);
  }

  /**
   * Upsert tags for a user. Ignores duplicates (ON CONFLICT DO NOTHING).
   */
  async saveTags(
    tenantId: string,
    userId: string,
    tags: string[],
    source: 'ai_detected' | 'manual' = 'ai_detected',
  ): Promise<void> {
    if (!tags.length) return;

    const db = getSupabaseAdmin();
    const rows = tags.map((tag) => ({
      tenant_id: tenantId,
      user_id: userId,
      tag,
      source,
    }));

    const { error } = await db
      .from('user_tags')
      .upsert(rows, { onConflict: 'tenant_id,user_id,tag', ignoreDuplicates: true });

    if (error) {
      log.error({ tenantId, userId, tags, error: error.message }, 'Failed to save user tags');
    } else {
      log.info({ tenantId, userId, tags }, 'Phone model tags saved');
    }
  }

  /**
   * List all distinct tags for a tenant (for UI dropdowns).
   */
  async listDistinctTags(tenantId: string): Promise<string[]> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('user_tags')
      .select('tag')
      .eq('tenant_id', tenantId)
      .order('tag');

    const unique = new Set((data || []).map((r) => r.tag));
    return Array.from(unique);
  }

  /**
   * Get all tags for a specific user.
   */
  async getUserTags(tenantId: string, userId: string) {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('user_tags')
      .select('tag, source, created_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    return data || [];
  }

  /**
   * Add a single tag manually (admin action).
   */
  async addTag(tenantId: string, userId: string, tag: string): Promise<void> {
    await this.saveTags(tenantId, userId, [tag], 'manual');
  }

  /**
   * Remove a specific tag from a user.
   */
  async removeTag(tenantId: string, userId: string, tag: string): Promise<void> {
    const db = getSupabaseAdmin();
    const { error } = await db
      .from('user_tags')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('tag', tag);

    if (error) {
      log.error({ tenantId, userId, tag, error: error.message }, 'Failed to remove tag');
    }
  }

  /**
   * List users filtered by tag, with pagination.
   */
  async listUsersByTag(
    tenantId: string,
    tag?: string,
    limit = 50,
    offset = 0,
  ): Promise<{ users: any[]; total: number }> {
    const db = getSupabaseAdmin();

    let query = db
      .from('user_tags')
      .select('user_id, tag, source, created_at, users!inner(id, display_name, unified_user_id)', {
        count: 'exact',
      })
      .eq('tenant_id', tenantId);

    if (tag) {
      query = query.eq('tag', tag);
    }

    const { data, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Group by user_id and collect all their tags
    const userMap = new Map<string, any>();
    for (const row of data || []) {
      const uid = row.user_id;
      if (!userMap.has(uid)) {
        const u = (row as any).users;
        userMap.set(uid, {
          id: uid,
          display_name: u?.display_name || uid,
          unified_user_id: u?.unified_user_id,
          tags: [],
        });
      }
      userMap.get(uid)!.tags.push(row.tag);
    }

    return { users: Array.from(userMap.values()), total: count || 0 };
  }
}

export const taggingService = new TaggingService();
