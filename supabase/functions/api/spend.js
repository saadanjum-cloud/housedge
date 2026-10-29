// The one place that decides whether AI work may spend money. Every paid call (Run now, each question in a check,
// Ask Housedge, outreach emails, website prefill) asks here first. Three locks, all must pass:
//   1. the client's monthly AI budget (set per client in the admin console);
//   2. the platform monthly cap: all AI spend across every client this month (Settings -> Costs & limits);
//   3. the trial daily cap: all AI spend today by self-signed-up clients without a fee, so bulk sign-ups
//      (each with a starter budget) cannot run up a bill.
// Reads run with full rights (the person may not see platform totals), after the caller confirmed access.
import { asService, get } from './db.js';

const fail = (message, status) => Object.assign(new Error(message), { status, expose: true });
const money = n => `$${Number(n || 0).toFixed(2)}`;

export async function spendStatus(orgId) {
  return asService(() => get(`
    WITH s AS (SELECT key, COALESCE(NULLIF(value #>> '{}', '')::numeric, 0) v FROM settings WHERE key IN ('monthly_cap', 'trial_daily_cap')),
    trial_orgs AS (SELECT o.id FROM orgs o WHERE o.fee IS NULL AND EXISTS (SELECT 1 FROM signups g WHERE g.org_id = o.id))
    SELECT o.monthly_budget::float AS budget, public.org_month_spend(o.id)::float AS spent,
      (o.id IN (SELECT id FROM trial_orgs)) AS trial,
      COALESCE((SELECT v FROM s WHERE key = 'monthly_cap'), 0)::float AS platform_cap,
      COALESCE((SELECT v FROM s WHERE key = 'trial_daily_cap'), 0)::float AS trial_cap,
      ((SELECT COALESCE(SUM(cost), 0) FROM answers WHERE created_at >= date_trunc('month', now()))
        + (SELECT COALESCE(SUM(cost), 0) FROM ai_spend WHERE created_at >= date_trunc('month', now())))::float AS platform_spent,
      ((SELECT COALESCE(SUM(cost), 0) FROM answers WHERE created_at >= date_trunc('day', now()) AND org_id IN (SELECT id FROM trial_orgs))
        + (SELECT COALESCE(SUM(cost), 0) FROM ai_spend WHERE created_at >= date_trunc('day', now()) AND org_id IN (SELECT id FROM trial_orgs)))::float AS trial_spent_today
    FROM orgs o WHERE o.id = ?`, orgId));
}

// Throws a readable error when spending `est` dollars now would break any lock.
export async function assertCanSpend(orgId, est) {
  const s = await spendStatus(orgId);
  if (!s) throw fail('Unknown company.', 404);
  if (!(s.budget > 0)) throw fail('Your monthly AI budget is not set yet. Your Housedge contact opens it before the first check.', 402);
  if (s.spent + est > s.budget) throw fail(`This would go over this month's AI budget (${money(s.spent)} of ${money(s.budget)} used). Your Housedge contact can raise it.`, 402);
  if (!(s.platform_cap > 0) || s.platform_spent + est > s.platform_cap) throw fail('AI checks are paused for today: the Housedge spending limit is reached. The team has been notified; please try again later.', 503);
  if (s.trial && s.trial_cap > 0 && s.trial_spent_today + est > s.trial_cap) throw fail('Trial checks are busy today. Please try again tomorrow, or contact us to upgrade.', 429);
  return s;
}
