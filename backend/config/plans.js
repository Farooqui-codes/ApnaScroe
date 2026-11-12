/**
 * Centralized Free vs Tournament Manager Pro Plan Configuration
 * Change plan prices, active billing mode, or Free tier limits here.
 */
const FREE_LIMITS = {
  maxTournaments: 1,
  maxTeamsPerTournament: 4,
  allowedFormats: ['knockout', 'league', 'round_robin']
};

const PRO_PLANS = {
  per_tournament: {
    id: 'per_tournament',
    name: 'Tournament Pro Pass',
    billingType: 'per_tournament',
    amountInr: Number(process.env.PRO_TOURNAMENT_FEE_INR) || 199,
    get amountPaise() {
      return this.amountInr * 100;
    },
    description: 'Unlock all Pro features permanently for 1 tournament.'
  },
  monthly: {
    id: 'monthly',
    name: 'Organizer Monthly Pro',
    billingType: 'monthly',
    amountInr: Number(process.env.PRO_MONTHLY_FEE_INR) || 499,
    get amountPaise() {
      return this.amountInr * 100;
    },
    durationDays: 30,
    description: 'Unlimited tournaments and Pro features for 30 days.'
  }
};

// Configurable mode: 'per_tournament' | 'monthly' | 'both'
const ACTIVE_PLAN_MODE = process.env.PRO_PLAN_MODE || 'both';

function hasProAccess(tournament, user) {
  if (user && user.role === 'super_admin') return true;
  if (tournament && tournament.plan === 'pro') return true;
  if (user && user.proExpiresAt && new Date(user.proExpiresAt) > new Date()) return true;
  return false;
}

module.exports = {
  FREE_LIMITS,
  PRO_PLANS,
  ACTIVE_PLAN_MODE,
  hasProAccess
};
