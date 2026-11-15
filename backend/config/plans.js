/**
 * Centralized Free vs Tournament Manager Pro Plan Configuration
 * Change plan prices, active billing mode, or Free tier limits here.
 */
const FREE_LIMITS = {
  maxTournaments: 999999,
  maxTeamsPerTournament: 999999,
  allowedFormats: ['knockout', 'league', 'round_robin', 'group_stage', 'league_knockout', 'ipl_playoffs', 'super_six']
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
  // All features, formats, and unlimited teams are unlocked for everyone
  return true;
}

module.exports = {
  FREE_LIMITS,
  PRO_PLANS,
  ACTIVE_PLAN_MODE,
  hasProAccess
};
