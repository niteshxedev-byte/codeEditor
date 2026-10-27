/**
 * Daily Per-User AI Quota Service
 * Enforces a daily request limit per user to prevent API quota depletion and abuse.
 */

const dailyAiUsage = new Map(); // key: `${userId}:${YYYY-MM-DD}`, value: count
const DAILY_AI_LIMIT = parseInt(process.env.DAILY_AI_LIMIT || "50", 10);

/**
 * Checks and increments the daily AI request count for a given user.
 * @param {string} userId - The authenticated user ID.
 * @returns {{ allowed: boolean, current: number, limit: number, remaining: number }}
 */
export function checkAndIncrementAiQuota(userId) {
  if (!userId) {
    // If somehow unauthenticated, deny or treat strictly
    return { allowed: false, current: 0, limit: DAILY_AI_LIMIT, remaining: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const key = `${userId}:${today}`;
  const current = dailyAiUsage.get(key) || 0;

  if (current >= DAILY_AI_LIMIT) {
    return {
      allowed: false,
      current,
      limit: DAILY_AI_LIMIT,
      remaining: 0,
    };
  }

  const nextCount = current + 1;
  dailyAiUsage.set(key, nextCount);

  // Periodically evict expired entries to keep memory bounded
  if (dailyAiUsage.size > 10000) {
    for (const [k] of dailyAiUsage.keys()) {
      if (!k.endsWith(today)) {
        dailyAiUsage.delete(k);
      }
    }
  }

  return {
    allowed: true,
    current: nextCount,
    limit: DAILY_AI_LIMIT,
    remaining: DAILY_AI_LIMIT - nextCount,
  };
}

/**
 * Gets remaining quota without incrementing
 * @param {string} userId 
 */
export function getAiQuotaStatus(userId) {
  if (!userId) return { allowed: false, current: 0, limit: DAILY_AI_LIMIT, remaining: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const key = `${userId}:${today}`;
  const current = dailyAiUsage.get(key) || 0;
  return {
    allowed: current < DAILY_AI_LIMIT,
    current,
    limit: DAILY_AI_LIMIT,
    remaining: Math.max(0, DAILY_AI_LIMIT - current)
  };
}
