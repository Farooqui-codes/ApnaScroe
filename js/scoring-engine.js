/**
 * ApnaScore – Isomorphic Cricket Scoring & Custom Rule Engine
 * Shared between Browser (Offline + Live UI) and Node.js Backend (Validation + Replay + Tests).
 * Event-sourced: given an innings setup and an ordered list of ball/action events,
 * deterministically computes the complete innings, batting, bowling, FOW, partnerships, and match state.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ApnaScoringEngine = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WICKET_TYPES = [
    { id: 'bowled', label: 'Bowled', creditBowler: true, countsAsWicket: true, short: 'b' },
    { id: 'caught', label: 'Caught', creditBowler: true, countsAsWicket: true, short: 'c' },
    { id: 'lbw', label: 'LBW', creditBowler: true, countsAsWicket: true, short: 'lbw' },
    { id: 'run_out', label: 'Run Out', creditBowler: false, countsAsWicket: true, short: 'run out' },
    { id: 'stumped', label: 'Stumped', creditBowler: true, countsAsWicket: true, short: 'st' },
    { id: 'hit_wicket', label: 'Hit Wicket', creditBowler: true, countsAsWicket: true, short: 'hit wkt' },
    { id: 'hit_ball_twice', label: 'Hit Ball Twice', creditBowler: false, countsAsWicket: true, short: 'hit twice' },
    { id: 'obstructing_field', label: 'Obstructing Field', creditBowler: false, countsAsWicket: true, short: 'obstructing' },
    { id: 'retired_out', label: 'Retired Out', creditBowler: false, countsAsWicket: true, short: 'retd out' },
    { id: 'timed_out', label: 'Timed Out', creditBowler: false, countsAsWicket: true, short: 'timed out' },
    { id: 'retired_hurt', label: 'Retired Hurt', creditBowler: false, countsAsWicket: false, short: 'retd hurt' }
  ];

  const WICKET_MAP = Object.fromEntries(WICKET_TYPES.map((w) => [w.id, w]));

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function mergeDeep(target, source) {
    if (!source || typeof source !== 'object') return target;
    const out = Array.isArray(target) ? target.slice() : Object.assign({}, target);
    for (const key of Object.keys(source)) {
      const val = source[key];
      if (val && typeof val === 'object' && !Array.isArray(val) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        out[key] = mergeDeep(target[key], val);
      } else if (val !== undefined) {
        out[key] = Array.isArray(val) ? val.slice() : val;
      }
    }
    return out;
  }

  /**
   * Default Standard Cricket ruleset. Every rule preset builds cleanly on top of this schema.
   */
  function getDefaultRules() {
    return {
      presetId: 'standard_cricket',
      presetName: 'Standard Cricket',
      format: {
        oversPerInnings: 20,
        ballsPerOver: 6,
        playersPerTeam: 11,
        maxWickets: 10,
        unlimitedWickets: false,
        ballType: 'leather', // tennis | leather | gully | street | box | school | custom
        allowSuperOverOnTie: true,
        noConsecutiveOversBySameBowler: true,
        maxOversPerBowler: 4
      },
      extras: {
        wide: {
          enabled: true,
          baseRuns: 1,
          allowAdditionalRuns: true,
          countsAsLegalDelivery: false,
          countsToTeam: true,
          countsToBatsman: false,
          countsToBowler: true,
          allowedWicketTypes: ['run_out', 'stumped', 'hit_wicket', 'obstructing_field']
        },
        noBall: {
          enabled: true,
          baseRuns: 1,
          allowBatRuns: true,
          allowAdditionalRuns: true,
          countsAsLegalDelivery: false,
          countsToTeam: true,
          countsToBatsman: false,
          countsToBowler: true,
          freeHitOnNextBall: true,
          allowedWicketTypes: ['run_out', 'hit_ball_twice', 'obstructing_field']
        },
        bye: {
          enabled: true,
          baseRuns: 0,
          allowAdditionalRuns: true,
          countsAsLegalDelivery: true,
          countsToTeam: true,
          countsToBatsman: false,
          countsToBowler: false
        },
        legBye: {
          enabled: true,
          baseRuns: 0,
          allowAdditionalRuns: true,
          countsAsLegalDelivery: true,
          countsToTeam: true,
          countsToBatsman: false,
          countsToBowler: false
        },
        overthrow: {
          enabled: true,
          countsToTeam: true,
          countsToBatsman: true,
          countsToBowler: true,
          rotatesStrikeOnOdd: true
        },
        penalty: {
          enabled: true,
          defaultRuns: 5,
          countsAsLegalDelivery: false,
          countsToTeam: true,
          countsToBatsman: false,
          countsToBowler: false
        },
        customExtra: {
          enabled: false,
          label: 'Bonus Extra',
          baseRuns: 1,
          allowAdditionalRuns: false,
          countsAsLegalDelivery: true,
          countsToTeam: true,
          countsToBatsman: false,
          countsToBowler: false
        }
      },
      boundaries: {
        fourRuns: 4,
        sixRuns: 6,
        directHitBoundaryEnabled: false,
        directHitRuns: 4,
        maxRunsPerDelivery: 0 // 0 = unlimited
      },
      wickets: {
        bowled: true,
        caught: true,
        lbw: true,
        run_out: true,
        stumped: true,
        hit_wicket: true,
        hit_ball_twice: true,
        obstructing_field: true,
        retired_out: true,
        timed_out: true,
        retired_hurt: true,
        allowRetiredHurtReturn: true,
        allowRetiredOutReturn: false
      },
      localRules: {
        oneTipOneHandCatch: false,
        lastManBatting: false,
        lastManStanding: false,
        fixedBatsmanRule: false,
        rotateStrikeOnOddRuns: true,
        rotateStrikeOnOverEnd: true,
        rotateStrikeOnExtrasCompletedRuns: true,
        customMaxWickets: null
      }
    };
  }

  /**
   * Built-in Rule Presets for village, gully, school, tennis, and standard cricket.
   */
  function getRulePresets() {
    const base = getDefaultRules();

    const village6 = mergeDeep(base, {
      presetId: 'village_6_over',
      presetName: '6-Over Village Match',
      format: {
        oversPerInnings: 6,
        playersPerTeam: 11,
        maxWickets: 10,
        ballType: 'tennis',
        maxOversPerBowler: 2
      },
      extras: {
        legBye: { enabled: false },
        noBall: { freeHitOnNextBall: true }
      },
      localRules: {
        lastManBatting: true,
        oneTipOneHandCatch: false
      }
    });

    const local8 = mergeDeep(base, {
      presetId: 'local_8_over',
      presetName: '8-Over Local Tournament',
      format: {
        oversPerInnings: 8,
        playersPerTeam: 11,
        maxWickets: 10,
        ballType: 'tennis',
        maxOversPerBowler: 2
      },
      localRules: {
        lastManBatting: false
      }
    });

    const gully = mergeDeep(base, {
      presetId: 'gully_cricket',
      presetName: 'Gully Cricket',
      format: {
        oversPerInnings: 6,
        playersPerTeam: 7,
        maxWickets: 6,
        ballType: 'gully',
        noConsecutiveOversBySameBowler: false,
        maxOversPerBowler: 0
      },
      extras: {
        legBye: { enabled: false },
        wide: { baseRuns: 1, countsAsLegalDelivery: false },
        noBall: { baseRuns: 1, freeHitOnNextBall: false }
      },
      wickets: {
        lbw: false,
        stumped: false
      },
      localRules: {
        oneTipOneHandCatch: true,
        lastManBatting: true,
        lastManStanding: true
      }
    });

    const tennis = mergeDeep(base, {
      presetId: 'tennis_ball',
      presetName: 'Tennis Ball Cricket',
      format: {
        oversPerInnings: 10,
        playersPerTeam: 11,
        maxWickets: 10,
        ballType: 'tennis',
        maxOversPerBowler: 3
      },
      wickets: {
        lbw: false
      },
      localRules: {
        lastManBatting: true
      }
    });

    const custom = mergeDeep(base, {
      presetId: 'custom',
      presetName: 'Custom Rules',
      format: {
        ballType: 'custom'
      }
    });

    return [base, village6, local8, gully, tennis, custom];
  }

  function getPresetById(presetId) {
    const presets = getRulePresets();
    return deepClone(presets.find((p) => p.presetId === presetId) || presets[0]);
  }

  /**
   * Normalizes & validates a rules object, returning { valid, errors, warnings, rules }.
   */
  function validateAndNormalizeRules(rawRules) {
    const base = getDefaultRules();
    const rules = mergeDeep(base, rawRules || {});
    const errors = [];
    const warnings = [];

    const overs = Number(rules.format.oversPerInnings);
    if (!Number.isFinite(overs) || overs < 1 || overs > 100) {
      errors.push('Overs per innings must be between 1 and 100.');
    } else {
      rules.format.oversPerInnings = Math.floor(overs);
    }

    const ballsPerOver = Number(rules.format.ballsPerOver);
    if (!Number.isFinite(ballsPerOver) || ballsPerOver < 1 || ballsPerOver > 12) {
      errors.push('Balls per over must be between 1 and 12.');
    } else {
      rules.format.ballsPerOver = Math.floor(ballsPerOver);
    }

    const playersPerTeam = Number(rules.format.playersPerTeam);
    if (!Number.isFinite(playersPerTeam) || playersPerTeam < 2 || playersPerTeam > 20) {
      errors.push('Players per team must be between 2 and 20.');
    } else {
      rules.format.playersPerTeam = Math.floor(playersPerTeam);
    }

    if (rules.localRules.lastManStanding) {
      rules.localRules.lastManBatting = true;
    }

    const customMax = rules.localRules.customMaxWickets;
    if (rules.format.unlimitedWickets) {
      rules.format.maxWickets = 9999;
    } else if (customMax !== null && customMax !== undefined && customMax !== '') {
      const parsed = Math.floor(Number(customMax));
      if (!Number.isFinite(parsed) || parsed < 1) {
        errors.push('Custom maximum wickets must be at least 1.');
      } else {
        rules.format.maxWickets = parsed;
      }
    } else {
      rules.format.maxWickets = rules.localRules.lastManBatting
        ? rules.format.playersPerTeam
        : Math.max(1, rules.format.playersPerTeam - 1);
    }

    // Ensure non-negative penalty runs
    for (const extraKey of ['wide', 'noBall', 'bye', 'legBye', 'customExtra']) {
      if (rules.extras[extraKey]) {
        const b = Number(rules.extras[extraKey].baseRuns);
        rules.extras[extraKey].baseRuns = Number.isFinite(b) && b >= 0 ? Math.floor(b) : 0;
      }
    }
    const pen = Number(rules.extras.penalty.defaultRuns);
    rules.extras.penalty.defaultRuns = Number.isFinite(pen) && pen >= 0 ? Math.floor(pen) : 5;

    if (rules.boundaries.fourRuns < 1 || rules.boundaries.sixRuns < 1) {
      errors.push('Boundary 4 and Six runs must be positive numbers.');
    }

    if (rules.format.maxOversPerBowler > 0 && rules.format.maxOversPerBowler * 2 < rules.format.oversPerInnings && rules.format.noConsecutiveOversBySameBowler && rules.format.playersPerTeam < 3) {
      warnings.push('With fewer than 3 players and consecutive overs prohibited, max overs per bowler may restrict bowling options.');
    }

    if (rules.localRules.oneTipOneHandCatch && !rules.wickets.caught) {
      warnings.push('One-tip-one-hand catch is enabled while Caught dismissals are disabled.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      rules
    };
  }

  /**
   * Formats legal balls into cricket overs string, e.g. 14 balls @ 6/over => "2.2"
   */
  function formatOvers(legalBalls, ballsPerOver = 6) {
    const bpo = ballsPerOver > 0 ? ballsPerOver : 6;
    const total = Math.max(0, Math.floor(Number(legalBalls) || 0));
    const overs = Math.floor(total / bpo);
    const rem = total % bpo;
    return `${overs}.${rem}`;
  }

  /**
   * Converts legal balls to decimal overs for NRR/Economy, e.g. 15 balls @ 6/over => 2.5
   */
  function ballsToDecimalOvers(legalBalls, ballsPerOver = 6) {
    const bpo = ballsPerOver > 0 ? ballsPerOver : 6;
    const total = Math.max(0, Number(legalBalls) || 0);
    const overs = Math.floor(total / bpo);
    const rem = total % bpo;
    return overs + rem / bpo;
  }

  function calcRunRate(runs, legalBalls, ballsPerOver = 6) {
    const dec = ballsToDecimalOvers(legalBalls, ballsPerOver);
    if (dec <= 0) return 0;
    return Number((runs / dec).toFixed(2));
  }

  function calcStrikeRate(runs, balls) {
    if (!balls || balls <= 0) return 0;
    return Number(((runs / balls) * 100).toFixed(2));
  }

  function calcEconomy(runsConceded, legalBalls, ballsPerOver = 6) {
    const dec = ballsToDecimalOvers(legalBalls, ballsPerOver);
    if (dec <= 0) return 0;
    return Number((runsConceded / dec).toFixed(2));
  }

  /**
   * Validate a single delivery payload before applying it.
   */
  function validateDeliveryInput(state, input, rawRules) {
    const { rules } = validateAndNormalizeRules(rawRules || state.rules);
    const errors = [];

    if (!state || state.status === 'completed' || state.status === 'abandoned') {
      errors.push('Innings is already completed.');
      return { valid: false, errors };
    }

    if (!state.strikerId) {
      errors.push('Select an active striker before scoring.');
    }
    if (!state.nonStrikerId && !rules.localRules.lastManBatting) {
      errors.push('Select a non-striker before scoring (Last-Man Batting is disabled).');
    }
    if (!state.currentBowlerId) {
      errors.push('Select a current bowler before scoring.');
    }

    const extraType = input.extraType || 'none'; // none | wide | no_ball | bye | leg_bye | penalty | custom_extra
    if (extraType === 'wide' && !rules.extras.wide.enabled) {
      errors.push('Wide balls are disabled in the current match rules.');
    }
    if (extraType === 'no_ball' && !rules.extras.noBall.enabled) {
      errors.push('No-balls are disabled in the current match rules.');
    }
    if (extraType === 'bye' && !rules.extras.bye.enabled) {
      errors.push('Byes are disabled in the current match rules.');
    }
    if (extraType === 'leg_bye' && !rules.extras.legBye.enabled) {
      errors.push('Leg-byes are disabled in the current match rules.');
    }
    if (extraType === 'custom_extra' && !rules.extras.customExtra.enabled) {
      errors.push('Custom extra runs are disabled in the current match rules.');
    }

    const batRuns = Math.max(0, Math.floor(Number(input.batRuns || 0)));
    const additionalExtraRuns = Math.max(0, Math.floor(Number(input.additionalExtraRuns || 0)));
    const overthrowRuns = Math.max(0, Math.floor(Number(input.overthrowRuns || 0)));

    if (overthrowRuns > 0 && !rules.extras.overthrow.enabled) {
      errors.push('Overthrow runs are disabled in the current match rules.');
    }

    if (extraType === 'no_ball' && batRuns > 0 && !rules.extras.noBall.allowBatRuns) {
      errors.push('Runs off the bat on a no-ball are disabled in the current match rules.');
    }
    if (extraType === 'wide' && batRuns > 0) {
      errors.push('Batsman cannot score bat runs off a wide; use additional extra runs instead.');
    }
    if ((extraType === 'bye' || extraType === 'leg_bye') && batRuns > 0) {
      errors.push('Byes and leg-byes cannot include bat runs.');
    }

    if (input.isWicket) {
      const wType = input.wicketType || 'bowled';
      if (!rules.wickets[wType]) {
        errors.push(`Dismissal type "${wType}" is disabled in the current match rules.`);
      }
      if (extraType === 'wide' && !rules.extras.wide.allowedWicketTypes.includes(wType)) {
        errors.push(`"${wType}" cannot happen on a wide ball under current rules.`);
      }
      if (extraType === 'no_ball' && !rules.extras.noBall.allowedWicketTypes.includes(wType)) {
        errors.push(`"${wType}" cannot happen on a no-ball under current rules.`);
      }
      if (state.isFreeHit && !['run_out', 'hit_ball_twice', 'obstructing_field'].includes(wType)) {
        errors.push(`"${wType}" is not allowed on a Free Hit delivery.`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Generates concise automatic ball-by-ball commentary.
   */
  function generateCommentary(computed) {
    if (computed.manualCommentary && computed.manualCommentary.trim()) {
      return computed.manualCommentary.trim();
    }
    const batsmanName = computed.strikerName || 'Batsman';
    const bowlerName = computed.bowlerName || 'Bowler';

    if (computed.eventType === 'retire') {
      return computed.wicketType === 'retired_hurt'
        ? `${computed.dismissedPlayerName || batsmanName} retires hurt.`
        : `${computed.dismissedPlayerName || batsmanName} is retired out.`;
    }

    const parts = [];
    if (computed.extraType === 'wide') {
      parts.push(`${bowlerName} delivers a wide${computed.additionalExtraRuns ? ` plus ${computed.additionalExtraRuns} extra run(s)` : ''}.`);
    } else if (computed.extraType === 'no_ball') {
      parts.push(`No ball from ${bowlerName}!${computed.batRuns ? ` ${batsmanName} hits ${computed.batRuns} run(s).` : ''}`);
    } else if (computed.extraType === 'bye') {
      parts.push(`${computed.totalRuns} bye(s) taken.`);
    } else if (computed.extraType === 'leg_bye') {
      parts.push(`${computed.totalRuns} leg-bye(s).`);
    } else if (computed.extraType === 'penalty') {
      parts.push(`${computed.totalRuns} penalty run(s) awarded.`);
    } else if (computed.extraType === 'custom_extra') {
      parts.push(`${computed.totalRuns} custom extra run(s) awarded.`);
    }

    if (computed.isWicket) {
      const wLabel = (WICKET_MAP[computed.wicketType] && WICKET_MAP[computed.wicketType].label) || 'Out';
      const who = computed.dismissedPlayerName || batsmanName;
      parts.push(`Wicket! ${who} is ${wLabel}${computed.oneTipCatch ? ' (One-tip one-hand!)' : ''}!`);
    } else if (computed.extraType === 'none') {
      if (computed.isSix) {
        parts.push(`Excellent six by ${batsmanName}!`);
      } else if (computed.isFour) {
        parts.push(`${batsmanName} hits a cracking boundary for ${computed.batRuns}!`);
      } else if (computed.batRuns === 0 && computed.overthrowRuns === 0) {
        parts.push(`Dot ball from ${bowlerName} to ${batsmanName}.`);
      } else if (computed.batRuns === 1) {
        parts.push(`${batsmanName} takes a quick single.`);
      } else if (computed.batRuns === 2) {
        parts.push(`Two runs completed by ${batsmanName}.`);
      } else if (computed.batRuns > 2) {
        parts.push(`${batsmanName} scores ${computed.batRuns} runs.`);
      }
    }

    if (computed.overthrowRuns > 0) {
      parts.push(`Overthrow adds ${computed.overthrowRuns} run(s).`);
    }
    if (computed.freeHitAwarded) {
      parts.push('Free hit coming up!');
    }

    return parts.join(' ').trim() || 'Ball bowled.';
  }

  function createEmptyInningsState(setup) {
    const { rules } = validateAndNormalizeRules(setup.rules);
    const playersMap = {};
    const battingList = Array.isArray(setup.battingSquad) ? setup.battingSquad : [];
    const bowlingList = Array.isArray(setup.bowlingSquad) ? setup.bowlingSquad : [];

    for (const p of battingList) {
      const id = String(p.playerId || p._id || p.id);
      playersMap[id] = { id, name: p.name || 'Player' };
    }
    for (const p of bowlingList) {
      const id = String(p.playerId || p._id || p.id);
      playersMap[id] = { id, name: p.name || 'Player' };
    }

    const state = {
      inningsNumber: setup.inningsNumber || 1,
      battingTeamId: setup.battingTeamId ? String(setup.battingTeamId) : null,
      battingTeamName: setup.battingTeamName || 'Batting Team',
      bowlingTeamId: setup.bowlingTeamId ? String(setup.bowlingTeamId) : null,
      bowlingTeamName: setup.bowlingTeamName || 'Bowling Team',
      target: setup.target ? Number(setup.target) : null,
      status: 'live', // live | paused | completed | abandoned
      rules,
      playersMap,
      battingOrder: [],
      battingStats: {},
      bowlingOrder: [],
      bowlingStats: {},
      strikerId: setup.openingStrikerId ? String(setup.openingStrikerId) : null,
      nonStrikerId: setup.openingNonStrikerId ? String(setup.openingNonStrikerId) : null,
      currentBowlerId: setup.openingBowlerId ? String(setup.openingBowlerId) : null,
      lastCompletedOverBowlerId: null,
      totalRuns: 0,
      wickets: 0,
      legalBalls: 0,
      ballsInCurrentOver: 0,
      completedOvers: 0,
      currentOverRunsConcededByBowler: 0,
      currentOverLegalBalls: 0,
      isFreeHit: false,
      needsBowlerChange: false,
      needsNewBatsman: false,
      dismissedSlot: null, // 'striker' | 'non_striker'
      extrasBreakdown: {
        wides: 0,
        noBalls: 0,
        byes: 0,
        legByes: 0,
        overthrows: 0,
        penalties: 0,
        customExtras: 0,
        total: 0
      },
      fallOfWickets: [],
      partnerships: [],
      currentPartnership: {
        batter1Id: setup.openingStrikerId ? String(setup.openingStrikerId) : null,
        batter2Id: setup.openingNonStrikerId ? String(setup.openingNonStrikerId) : null,
        runs: 0,
        balls: 0
      },
      recentBalls: [],
      commentary: [],
      endReason: null
    };

    if (state.strikerId) ensureBatter(state, state.strikerId, setup.openingStrikerName);
    if (state.nonStrikerId) ensureBatter(state, state.nonStrikerId, setup.openingNonStrikerName);
    if (state.currentBowlerId) ensureBowler(state, state.currentBowlerId, setup.openingBowlerName);

    return state;
  }

  function ensureBatter(state, playerId, fallbackName) {
    if (!playerId) return null;
    const id = String(playerId);
    if (!state.battingStats[id]) {
      const name = fallbackName || (state.playersMap[id] && state.playersMap[id].name) || 'Batsman';
      state.playersMap[id] = { id, name };
      state.battingOrder.push(id);
      state.battingStats[id] = {
        playerId: id,
        name,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        strikeRate: 0,
        isOut: false,
        isRetiredHurt: false,
        dismissalType: null,
        dismissalText: 'not out',
        bowlerId: null,
        fielderId: null
      };
    }
    return state.battingStats[id];
  }

  function ensureBowler(state, playerId, fallbackName) {
    if (!playerId) return null;
    const id = String(playerId);
    if (!state.bowlingStats[id]) {
      const name = fallbackName || (state.playersMap[id] && state.playersMap[id].name) || 'Bowler';
      state.playersMap[id] = { id, name };
      state.bowlingOrder.push(id);
      state.bowlingStats[id] = {
        playerId: id,
        name,
        legalBalls: 0,
        overs: '0.0',
        maidens: 0,
        runs: 0,
        wickets: 0,
        wides: 0,
        noBalls: 0,
        economy: 0
      };
    }
    return state.bowlingStats[id];
  }

  function applyEvent(state, event) {
    const rules = state.rules;
    const bpo = rules.format.ballsPerOver || 6;
    const type = event.eventType || 'delivery';

    if (type === 'set_openers') {
      if (event.strikerId) {
        state.strikerId = String(event.strikerId);
        ensureBatter(state, state.strikerId, event.strikerName);
      }
      if (event.nonStrikerId) {
        state.nonStrikerId = String(event.nonStrikerId);
        ensureBatter(state, state.nonStrikerId, event.nonStrikerName);
      }
      if (event.bowlerId) {
        state.currentBowlerId = String(event.bowlerId);
        ensureBowler(state, state.currentBowlerId, event.bowlerName);
      }
      state.currentPartnership = {
        batter1Id: state.strikerId,
        batter2Id: state.nonStrikerId,
        runs: 0,
        balls: 0
      };
      return state;
    }

    if (type === 'swap_batsmen') {
      if (state.strikerId && state.nonStrikerId) {
        const tmp = state.strikerId;
        state.strikerId = state.nonStrikerId;
        state.nonStrikerId = tmp;
      }
      return state;
    }

    if (type === 'change_striker') {
      if (event.strikerId) {
        state.strikerId = String(event.strikerId);
        ensureBatter(state, state.strikerId, event.strikerName);
      }
      return state;
    }

    if (type === 'change_bowler') {
      if (event.bowlerId) {
        state.currentBowlerId = String(event.bowlerId);
        ensureBowler(state, state.currentBowlerId, event.bowlerName);
        state.needsBowlerChange = false;
      }
      return state;
    }

    if (type === 'new_batsman') {
      const incomingId = String(event.playerId);
      const batter = ensureBatter(state, incomingId, event.playerName);
      if (batter) {
        batter.isRetiredHurt = false;
        batter.isOut = false;
        if (batter.dismissalText === 'retired hurt') {
          batter.dismissalText = 'not out';
        }
      }
      if (event.slot === 'non_striker' || state.dismissedSlot === 'non_striker') {
        state.nonStrikerId = incomingId;
      } else {
        state.strikerId = incomingId;
      }
      state.needsNewBatsman = false;
      state.dismissedSlot = null;
      state.currentPartnership = {
        batter1Id: state.strikerId,
        batter2Id: state.nonStrikerId,
        runs: 0,
        balls: 0
      };
      return state;
    }

    if (type === 'retire') {
      const role = event.slot === 'non_striker' ? 'non_striker' : 'striker';
      const playerId = role === 'non_striker' ? state.nonStrikerId : state.strikerId;
      if (!playerId) return state;
      const batter = ensureBatter(state, playerId, event.playerName);
      const isOut = event.wicketType === 'retired_out';
      batter.isOut = isOut;
      batter.isRetiredHurt = !isOut;
      batter.dismissalType = isOut ? 'retired_out' : 'retired_hurt';
      batter.dismissalText = isOut ? 'retired out' : 'retired hurt';

      if (isOut) {
        state.wickets += 1;
        state.fallOfWickets.push({
          wicketNumber: state.wickets,
          score: state.totalRuns,
          overs: formatOvers(state.legalBalls, bpo),
          playerId,
          playerName: batter.name,
          dismissalType: 'retired_out'
        });
      }

      if (state.currentPartnership && (state.currentPartnership.runs > 0 || state.currentPartnership.balls > 0)) {
        state.partnerships.push(Object.assign({}, state.currentPartnership));
      }

      if (role === 'striker') state.strikerId = null;
      else state.nonStrikerId = null;

      state.dismissedSlot = role;
      state.needsNewBatsman = !checkInningsEnd(state);
      if (event.replacementPlayerId) {
        applyEvent(state, {
          eventType: 'new_batsman',
          playerId: event.replacementPlayerId,
          playerName: event.replacementPlayerName,
          slot: role
        });
      }

      state.commentary.unshift({
        id: event.eventId,
        over: formatOvers(state.legalBalls, bpo),
        text: generateCommentary({
          eventType: 'retire',
          wicketType: batter.dismissalType,
          dismissedPlayerName: batter.name,
          manualCommentary: event.commentary
        }),
        badge: isOut ? 'RO' : 'RH'
      });
      return state;
    }

    if (type === 'end_over') {
      // Force close an incomplete or completed over manually
      if (state.ballsInCurrentOver > 0) {
        state.completedOvers += 1;
        state.ballsInCurrentOver = 0;
        state.currentOverLegalBalls = 0;
        state.currentOverRunsConcededByBowler = 0;
        state.lastCompletedOverBowlerId = state.currentBowlerId;
        if (rules.localRules.rotateStrikeOnOverEnd && !rules.localRules.fixedBatsmanRule && state.strikerId && state.nonStrikerId) {
          const tmp = state.strikerId;
          state.strikerId = state.nonStrikerId;
          state.nonStrikerId = tmp;
        }
        state.needsBowlerChange = true;
      }
      if (state.completedOvers >= rules.format.oversPerInnings) {
        state.status = 'completed';
        state.endReason = 'overs_completed';
        state.needsBowlerChange = false;
      }
      return state;
    }

    if (type === 'end_innings') {
      state.status = 'completed';
      state.endReason = event.reason || 'declared_or_ended';
      state.needsBowlerChange = false;
      state.needsNewBatsman = false;
      return state;
    }

    if (type === 'score_correction') {
      const deltaRuns = Math.floor(Number(event.deltaRuns || 0));
      state.totalRuns = Math.max(0, state.totalRuns + deltaRuns);
      state.commentary.unshift({
        id: event.eventId,
        over: formatOvers(state.legalBalls, bpo),
        text: event.commentary || `Manual score adjustment (${deltaRuns >= 0 ? '+' : ''}${deltaRuns} runs).`,
        badge: 'ADJ'
      });
      checkInningsEnd(state);
      return state;
    }

    // Standard ball delivery event
    const extraType = event.extraType || 'none';
    const batRunsRaw = Math.max(0, Math.floor(Number(event.batRuns || 0)));
    const additionalExtraRuns = Math.max(0, Math.floor(Number(event.additionalExtraRuns || 0)));
    const overthrowRuns = rules.extras.overthrow.enabled ? Math.max(0, Math.floor(Number(event.overthrowRuns || 0))) : 0;

    const striker = ensureBatter(state, event.strikerId || state.strikerId, event.strikerName);
    const bowler = ensureBowler(state, event.bowlerId || state.currentBowlerId, event.bowlerName);

    let isLegalDelivery = true;
    let penaltyToTeam = 0;
    let extraToTeam = 0;
    let bowlerPenaltyRuns = 0;
    let countsBallToBatsman = true;
    let batRuns = batRunsRaw;
    let completedRunningRuns = 0;
    const canHitBoundary = extraType === 'none' || (extraType === 'no_ball' && rules.extras.noBall.allowBatRuns);
    let isBoundaryFour = Boolean(event.isFour || (canHitBoundary && batRuns === rules.boundaries.fourRuns && !event.notBoundary));
    let isBoundarySix = Boolean(event.isSix || (canHitBoundary && batRuns === rules.boundaries.sixRuns && !event.notBoundary));

    if (extraType === 'wide') {
      const cfg = rules.extras.wide;
      isLegalDelivery = Boolean(cfg.countsAsLegalDelivery);
      countsBallToBatsman = false;
      batRuns = 0;
      isBoundaryFour = false;
      isBoundarySix = false;
      const totalWideRuns = cfg.baseRuns + (cfg.allowAdditionalRuns ? additionalExtraRuns : 0);
      if (cfg.countsToTeam) extraToTeam += totalWideRuns;
      if (cfg.countsToBowler) bowlerPenaltyRuns += totalWideRuns;
      state.extrasBreakdown.wides += totalWideRuns;
      if (bowler) bowler.wides += 1;
      completedRunningRuns = cfg.allowAdditionalRuns ? additionalExtraRuns : 0;
    } else if (extraType === 'no_ball') {
      const cfg = rules.extras.noBall;
      isLegalDelivery = Boolean(cfg.countsAsLegalDelivery);
      countsBallToBatsman = true; // In cricket, no-ball counts as a ball faced by the batsman
      const base = cfg.baseRuns;
      const addExtra = cfg.allowAdditionalRuns ? additionalExtraRuns : 0;
      const nbExtraTotal = base + addExtra;
      if (cfg.countsToTeam) extraToTeam += nbExtraTotal;
      if (cfg.countsToBowler) bowlerPenaltyRuns += base + (cfg.allowBatRuns ? batRuns : 0);
      state.extrasBreakdown.noBalls += nbExtraTotal;
      if (bowler) bowler.noBalls += 1;
      completedRunningRuns = (cfg.allowBatRuns ? batRuns : 0) + addExtra;
    } else if (extraType === 'bye') {
      const cfg = rules.extras.bye;
      isLegalDelivery = Boolean(cfg.countsAsLegalDelivery);
      countsBallToBatsman = true;
      batRuns = 0;
      isBoundaryFour = false;
      isBoundarySix = false;
      const byeTotal = cfg.baseRuns + (cfg.allowAdditionalRuns ? additionalExtraRuns : 0);
      if (cfg.countsToTeam) extraToTeam += byeTotal;
      if (cfg.countsToBowler) bowlerPenaltyRuns += byeTotal;
      state.extrasBreakdown.byes += byeTotal;
      completedRunningRuns = cfg.allowAdditionalRuns ? additionalExtraRuns : 0;
    } else if (extraType === 'leg_bye') {
      const cfg = rules.extras.legBye;
      isLegalDelivery = Boolean(cfg.countsAsLegalDelivery);
      countsBallToBatsman = true;
      batRuns = 0;
      isBoundaryFour = false;
      isBoundarySix = false;
      const lbTotal = cfg.baseRuns + (cfg.allowAdditionalRuns ? additionalExtraRuns : 0);
      if (cfg.countsToTeam) extraToTeam += lbTotal;
      if (cfg.countsToBowler) bowlerPenaltyRuns += lbTotal;
      state.extrasBreakdown.legByes += lbTotal;
      completedRunningRuns = cfg.allowAdditionalRuns ? additionalExtraRuns : 0;
    } else if (extraType === 'penalty') {
      const cfg = rules.extras.penalty;
      isLegalDelivery = Boolean(cfg.countsAsLegalDelivery);
      countsBallToBatsman = false;
      batRuns = 0;
      const pRuns = additionalExtraRuns > 0 ? additionalExtraRuns : cfg.defaultRuns;
      if (cfg.countsToTeam) penaltyToTeam += pRuns;
      if (cfg.countsToBowler) bowlerPenaltyRuns += pRuns;
      state.extrasBreakdown.penalties += pRuns;
      completedRunningRuns = 0;
    } else if (extraType === 'custom_extra') {
      const cfg = rules.extras.customExtra;
      isLegalDelivery = Boolean(cfg.countsAsLegalDelivery);
      countsBallToBatsman = Boolean(cfg.countsToBatsman);
      batRuns = 0;
      const cRuns = cfg.baseRuns + (cfg.allowAdditionalRuns ? additionalExtraRuns : 0);
      if (cfg.countsToTeam) extraToTeam += cRuns;
      if (cfg.countsToBowler) bowlerPenaltyRuns += cRuns;
      state.extrasBreakdown.customExtras += cRuns;
      completedRunningRuns = 0;
    } else {
      // Normal delivery
      completedRunningRuns = (isBoundaryFour || isBoundarySix) ? 0 : batRuns;
      if (rules.extras.noBall.countsToBowler || true) {
        bowlerPenaltyRuns += batRuns;
      }
    }

    // Overthrows
    let overthrowToTeam = 0;
    let overthrowToBatsman = 0;
    let overthrowToBowler = 0;
    if (overthrowRuns > 0) {
      const ot = rules.extras.overthrow;
      if (ot.countsToTeam) overthrowToTeam = overthrowRuns;
      if (ot.countsToBatsman && (extraType === 'none' || extraType === 'no_ball')) overthrowToBatsman = overthrowRuns;
      if (ot.countsToBowler) overthrowToBowler = overthrowRuns;
      state.extrasBreakdown.overthrows += overthrowRuns;
      if (ot.rotatesStrikeOnOdd && !event.overthrowBoundary) {
        completedRunningRuns += overthrowRuns;
      }
    }

    let deliveryTeamRuns =
      (extraType === 'no_ball' ? (rules.extras.noBall.allowBatRuns ? batRuns : 0) : batRuns) +
      extraToTeam +
      penaltyToTeam +
      overthrowToTeam;

    if (rules.boundaries.maxRunsPerDelivery > 0) {
      deliveryTeamRuns = Math.min(deliveryTeamRuns, rules.boundaries.maxRunsPerDelivery);
    }

    // Update totals
    state.totalRuns += deliveryTeamRuns;
    state.extrasBreakdown.total =
      state.extrasBreakdown.wides +
      state.extrasBreakdown.noBalls +
      state.extrasBreakdown.byes +
      state.extrasBreakdown.legByes +
      state.extrasBreakdown.penalties +
      state.extrasBreakdown.customExtras;

    // Update batter stats
    if (striker) {
      const batCredit = (extraType === 'none' || (extraType === 'no_ball' && rules.extras.noBall.allowBatRuns)) ? batRuns : 0;
      striker.runs += batCredit + overthrowToBatsman;
      if (countsBallToBatsman) striker.balls += 1;
      if (isBoundaryFour) striker.fours += 1;
      if (isBoundarySix) striker.sixes += 1;
      striker.strikeRate = calcStrikeRate(striker.runs, striker.balls);
    }

    // Update bowler stats
    const totalBowlerRuns = bowlerPenaltyRuns + overthrowToBowler;
    if (bowler) {
      bowler.runs += totalBowlerRuns;
      if (isLegalDelivery) {
        bowler.legalBalls += 1;
      }
      bowler.overs = formatOvers(bowler.legalBalls, bpo);
      bowler.economy = calcEconomy(bowler.runs, bowler.legalBalls, bpo);
    }

    // Update partnership
    if (state.currentPartnership) {
      state.currentPartnership.runs += deliveryTeamRuns;
      if (isLegalDelivery || countsBallToBatsman) {
        state.currentPartnership.balls += 1;
      }
    }

    // Track current over runs for maiden calculation
    state.currentOverRunsConcededByBowler += totalBowlerRuns;

    // Legal ball increment
    if (isLegalDelivery) {
      state.legalBalls += 1;
      state.ballsInCurrentOver += 1;
      state.currentOverLegalBalls += 1;
    }

    const ballOverLabel = formatOvers(Math.max(0, state.legalBalls - (isLegalDelivery ? 1 : 0)), bpo);

    // Handle wicket
    let isWicketCounted = false;
    let dismissedBatterName = null;
    if (event.isWicket) {
      const wType = event.wicketType || 'bowled';
      const wMeta = WICKET_MAP[wType] || { label: 'Out', creditBowler: false, countsAsWicket: true, short: 'out' };
      const dismissedSlot = event.dismissedSlot === 'non_striker' ? 'non_striker' : 'striker';
      const dismissedId = event.dismissedPlayerId
        ? String(event.dismissedPlayerId)
        : (dismissedSlot === 'non_striker' ? state.nonStrikerId : state.strikerId);
      const dismissedBatter = dismissedId ? ensureBatter(state, dismissedId, event.dismissedPlayerName) : null;

      if (dismissedBatter) {
        dismissedBatterName = dismissedBatter.name;
        if (wMeta.countsAsWicket) {
          isWicketCounted = true;
          dismissedBatter.isOut = true;
          dismissedBatter.dismissalType = wType;
          const fielderPart = event.fielderName ? ` (${event.fielderName})` : '';
          dismissedBatter.dismissalText = wMeta.creditBowler && bowler
            ? `${wMeta.short}${fielderPart} b ${bowler.name}`
            : `${wMeta.short}${fielderPart}`;
          dismissedBatter.bowlerId = wMeta.creditBowler && bowler ? bowler.playerId : null;
          dismissedBatter.fielderId = event.fielderId ? String(event.fielderId) : null;
          state.wickets += 1;
          if (wMeta.creditBowler && bowler) {
            bowler.wickets += 1;
          }
          state.fallOfWickets.push({
            wicketNumber: state.wickets,
            score: state.totalRuns,
            overs: formatOvers(state.legalBalls, bpo),
            playerId: dismissedBatter.playerId,
            playerName: dismissedBatter.name,
            dismissalType: wType
          });
        } else {
          // retired_hurt
          dismissedBatter.isRetiredHurt = true;
          dismissedBatter.dismissalType = wType;
          dismissedBatter.dismissalText = 'retired hurt';
        }
      }

      if (state.currentPartnership) {
        state.partnerships.push(Object.assign({}, state.currentPartnership));
      }

      if (dismissedSlot === 'non_striker') {
        state.nonStrikerId = null;
      } else {
        state.strikerId = null;
      }

      // If Last-Man Batting is enabled and only 1 player remains (wickets === playersPerTeam - 1),
      // promote the surviving batter to striker so they can bat alone without needing a new partner.
      const onlyLastManLeft = rules.localRules.lastManBatting && !rules.format.unlimitedWickets && state.wickets === (rules.format.playersPerTeam - 1);
      if (onlyLastManLeft) {
        if (!state.strikerId && state.nonStrikerId) {
          state.strikerId = state.nonStrikerId;
          state.nonStrikerId = null;
        }
        state.dismissedSlot = null;
        state.needsNewBatsman = false;
      } else {
        state.dismissedSlot = dismissedSlot;
        state.needsNewBatsman = true;
      }
    }

    // Strike rotation on completed runs (if batters didn't get out or if non-striker was run out / striker survived)
    const shouldRotateRuns = (() => {
      if (rules.localRules.fixedBatsmanRule) return false;
      if (rules.localRules.lastManBatting && !state.nonStrikerId && !state.needsNewBatsman) return false;
      if (extraType === 'none' || extraType === 'no_ball') {
        return rules.localRules.rotateStrikeOnOddRuns && completedRunningRuns % 2 === 1;
      }
      if (extraType === 'wide' || extraType === 'bye' || extraType === 'leg_bye') {
        return rules.localRules.rotateStrikeOnExtrasCompletedRuns && completedRunningRuns % 2 === 1;
      }
      return false;
    })();

    if (shouldRotateRuns && state.strikerId && state.nonStrikerId) {
      const tmp = state.strikerId;
      state.strikerId = state.nonStrikerId;
      state.nonStrikerId = tmp;
    }

    // Free hit state update
    const prevWasFreeHit = state.isFreeHit;
    if (extraType === 'no_ball' && rules.extras.noBall.freeHitOnNextBall) {
      state.isFreeHit = true;
    } else if (isLegalDelivery && prevWasFreeHit) {
      state.isFreeHit = false;
    }

    // Check over completion
    let overCompletedNow = false;
    if (isLegalDelivery && state.ballsInCurrentOver >= bpo) {
      overCompletedNow = true;
      state.completedOvers += 1;
      state.ballsInCurrentOver = 0;
      if (bowler && state.currentOverRunsConcededByBowler === 0 && state.currentOverLegalBalls >= bpo) {
        bowler.maidens += 1;
      }
      state.currentOverLegalBalls = 0;
      state.currentOverRunsConcededByBowler = 0;
      state.lastCompletedOverBowlerId = state.currentBowlerId;

      if (rules.localRules.rotateStrikeOnOverEnd && !rules.localRules.fixedBatsmanRule) {
        if (state.strikerId && state.nonStrikerId) {
          const tmp = state.strikerId;
          state.strikerId = state.nonStrikerId;
          state.nonStrikerId = tmp;
        } else if (state.needsNewBatsman && state.dismissedSlot) {
          // If wicket fell on last ball of over, swap the incoming slot so the surviving batter takes non-striker/striker appropriately
          state.dismissedSlot = state.dismissedSlot === 'striker' ? 'non_striker' : 'striker';
        }
      }
    }

    // Badge for recent balls timeline
    let badge = String(deliveryTeamRuns);
    if (event.isWicket && isWicketCounted) {
      badge = deliveryTeamRuns > 0 ? `W+${deliveryTeamRuns}` : 'W';
    } else if (extraType === 'wide') {
      badge = additionalExtraRuns > 0 ? `WD+${additionalExtraRuns}` : 'WD';
    } else if (extraType === 'no_ball') {
      badge = batRuns > 0 ? `NB+${batRuns}` : 'NB';
    } else if (extraType === 'bye') {
      badge = `${deliveryTeamRuns}B`;
    } else if (extraType === 'leg_bye') {
      badge = `${deliveryTeamRuns}LB`;
    } else if (extraType === 'penalty') {
      badge = `${deliveryTeamRuns}P`;
    }

    const ballSummary = {
      eventId: event.eventId,
      sequence: event.sequence,
      overLabel: ballOverLabel,
      overNumber: state.completedOvers + (overCompletedNow ? 0 : 1),
      badge,
      extraType,
      batRuns,
      additionalExtraRuns,
      overthrowRuns,
      totalRuns: deliveryTeamRuns,
      isLegalDelivery,
      isBoundaryFour,
      isBoundarySix,
      isWicket: Boolean(event.isWicket && isWicketCounted),
      wicketType: event.isWicket ? event.wicketType : null,
      strikerId: striker ? striker.playerId : null,
      strikerName: striker ? striker.name : null,
      bowlerId: bowler ? bowler.playerId : null,
      bowlerName: bowler ? bowler.name : null
    };

    state.recentBalls.push(ballSummary);

    state.commentary.unshift({
      id: event.eventId,
      over: ballOverLabel,
      badge,
      text: generateCommentary({
        eventType: 'delivery',
        strikerName: striker ? striker.name : 'Batsman',
        bowlerName: bowler ? bowler.name : 'Bowler',
        extraType,
        batRuns,
        additionalExtraRuns,
        overthrowRuns,
        totalRuns: deliveryTeamRuns,
        isFour: isBoundaryFour,
        isSix: isBoundarySix,
        isWicket: Boolean(event.isWicket),
        wicketType: event.wicketType,
        dismissedPlayerName: dismissedBatterName,
        oneTipCatch: Boolean(event.oneTipCatch),
        freeHitAwarded: extraType === 'no_ball' && rules.extras.noBall.freeHitOnNextBall,
        manualCommentary: event.commentary
      })
    });

    // Check innings end conditions
    const ended = checkInningsEnd(state);
    if (ended) {
      state.needsBowlerChange = false;
      state.needsNewBatsman = false;
    } else if (overCompletedNow) {
      state.needsBowlerChange = true;
    }

    return state;
  }

  function checkInningsEnd(state) {
    const rules = state.rules;
    const bpo = rules.format.ballsPerOver || 6;
    const maxBalls = rules.format.oversPerInnings * bpo;

    // 1. Target chased in 2nd innings
    if (state.target && state.totalRuns >= state.target) {
      state.status = 'completed';
      state.endReason = 'target_chased';
      return true;
    }

    // 2. All out (respecting unlimitedWickets & lastManBatting)
    if (!rules.format.unlimitedWickets && state.wickets >= rules.format.maxWickets) {
      state.status = 'completed';
      state.endReason = 'all_out';
      return true;
    }

    // 3. Overs completed
    if (state.legalBalls >= maxBalls) {
      state.status = 'completed';
      state.endReason = 'overs_completed';
      return true;
    }

    return false;
  }

  /**
   * Deterministic full replay from an innings setup + ordered array of events.
   */
  function replayInnings(setup, events) {
    const state = createEmptyInningsState(setup);
    const activeEvents = (events || [])
      .filter((ev) => !ev.isVoided)
      .slice()
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    for (const ev of activeEvents) {
      applyEvent(state, ev);
      if (state.status === 'completed') break;
    }

    const bpo = state.rules.format.ballsPerOver || 6;
    const totalBallsAllowed = state.rules.format.oversPerInnings * bpo;
    state.oversString = formatOvers(state.legalBalls, bpo);
    state.currentRunRate = calcRunRate(state.totalRuns, state.legalBalls, bpo);
    state.remainingBalls = Math.max(0, totalBallsAllowed - state.legalBalls);
    if (state.target) {
      state.remainingRuns = Math.max(0, state.target - state.totalRuns);
      state.requiredRunRate = state.remainingBalls > 0
        ? calcRunRate(state.remainingRuns, state.remainingBalls, bpo)
        : 0;
    } else {
      state.remainingRuns = null;
      state.requiredRunRate = null;
    }

    return state;
  }

  /**
   * Computes match result given 1st innings and 2nd innings final states.
   */
  function evaluateMatchResult(innings1, innings2, rules) {
    if (!innings1 || !innings2) return null;
    const r1 = innings1.totalRuns || 0;
    const r2 = innings2.totalRuns || 0;
    const maxWickets = (rules && rules.format && rules.format.maxWickets) || 10;

    if (r2 > r1) {
      const wicketsRemaining = Math.max(1, maxWickets - (innings2.wickets || 0));
      return {
        status: 'completed',
        isTie: false,
        winnerTeamId: innings2.battingTeamId,
        winnerTeamName: innings2.battingTeamName,
        marginText: `${innings2.battingTeamName} won by ${wicketsRemaining} wicket${wicketsRemaining === 1 ? '' : 's'}`
      };
    }
    if (r1 > r2) {
      const runMargin = r1 - r2;
      return {
        status: 'completed',
        isTie: false,
        winnerTeamId: innings1.battingTeamId,
        winnerTeamName: innings1.battingTeamName,
        marginText: `${innings1.battingTeamName} won by ${runMargin} run${runMargin === 1 ? '' : 's'}`
      };
    }
    return {
      status: 'tied',
      isTie: true,
      winnerTeamId: null,
      winnerTeamName: null,
      marginText: 'Match Tied'
    };
  }

  /**
   * Net Run Rate calculation for a team across matches.
   * Per ICC / standard cricket rules: if a team is bowled all out, their overs faced
   * is credited as the full scheduled overs of the match (unless unlimited wickets).
   */
  function calculateTeamNRR(teamMatchStats) {
    let totalRunsScored = 0;
    let totalOversFaced = 0;
    let totalRunsConceded = 0;
    let totalOversBowled = 0;

    for (const m of teamMatchStats || []) {
      const bpo = m.ballsPerOver || 6;
      const scheduledOvers = m.scheduledOvers || 20;

      const oversFaced = m.wasAllOut
        ? scheduledOvers
        : ballsToDecimalOvers(m.ballsFaced || 0, bpo);

      const oversBowled = m.opponentWasAllOut
        ? scheduledOvers
        : ballsToDecimalOvers(m.ballsBowled || 0, bpo);

      totalRunsScored += m.runsScored || 0;
      totalOversFaced += oversFaced;
      totalRunsConceded += m.runsConceded || 0;
      totalOversBowled += oversBowled;
    }

    const forRate = totalOversFaced > 0 ? totalRunsScored / totalOversFaced : 0;
    const againstRate = totalOversBowled > 0 ? totalRunsConceded / totalOversBowled : 0;
    return Number((forRate - againstRate).toFixed(3));
  }

  return {
    WICKET_TYPES,
    getDefaultRules,
    getRulePresets,
    getPresetById,
    validateAndNormalizeRules,
    validateDeliveryInput,
    createEmptyInningsState,
    applyEvent,
    replayInnings,
    evaluateMatchResult,
    calculateTeamNRR,
    formatOvers,
    ballsToDecimalOvers,
    calcRunRate,
    calcStrikeRate,
    calcEconomy
  };
}));
