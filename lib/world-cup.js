import { randomUUID } from 'node:crypto';

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const CACHE_MS = 15_000;
let cache;

const fallbackMatches = [
  { id: 'wc-qf-99', home: 'Norway', away: 'England', homeCode: 'NOR', awayCode: 'ENG', score: '21:00', minute: null, status: 'upcoming', stage: 'Quarterfinals', venue: 'Hard Rock Stadium', kickoff: '2026-07-11T21:00:00Z', metrics: {}, sourceProvider: 'GoalGate verified schedule fallback', sourceUrl: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026' },
  { id: 'wc-qf-100', home: 'Argentina', away: 'Switzerland', homeCode: 'ARG', awayCode: 'SUI', score: '01:00', minute: null, status: 'upcoming', stage: 'Quarterfinals', venue: 'GEHA Field at Arrowhead Stadium', kickoff: '2026-07-12T01:00:00Z', metrics: {}, sourceProvider: 'GoalGate verified schedule fallback', sourceUrl: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026' }
];

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function rollingDateWindow(date = new Date()) {
  const previous = new Date(date);
  const next = new Date(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${dateKey(previous)}-${dateKey(next)}`;
}

function numericStats(competitor) {
  return Object.fromEntries((competitor?.statistics || []).map((stat) => [stat.name, Number.parseFloat(stat.displayValue)]));
}

function normalizeEvent(event) {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((team) => team.homeAway === 'home');
  const away = competition?.competitors?.find((team) => team.homeAway === 'away');
  if (!competition || !home || !away) return null;

  const state = competition.status?.type?.state;
  const status = state === 'in' ? 'live' : state === 'post' ? 'final' : 'upcoming';
  const minute = status === 'live' ? Math.max(1, Math.floor((competition.status.clock || 0) / 60)) : null;
  const kickoff = event.date || competition.date;
  const kickoffLabel = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(kickoff));
  const link = event.links?.find((item) => item.rel?.includes('summary'))?.href || `https://www.espn.com/soccer/match/_/gameId/${event.id}`;

  return {
    id: `espn-${event.id}`,
    home: home.team.displayName,
    away: away.team.displayName,
    homeCode: home.team.abbreviation,
    awayCode: away.team.abbreviation,
    score: status === 'upcoming' ? kickoffLabel : `${home.score} : ${away.score}`,
    minute,
    status,
    statusDetail: competition.status?.type?.detail || competition.status?.type?.description,
    stage: competition.altGameNote || event.season?.slug || 'FIFA World Cup 2026',
    venue: competition.venue?.fullName || event.venue?.displayName,
    kickoff,
    metrics: { home: numericStats(home), away: numericStats(away) },
    sourceProvider: 'ESPN World Cup scoreboard',
    sourceUrl: link
  };
}

export async function getWorldCupMatches() {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  try {
    const response = await fetch(`${ESPN_SCOREBOARD}?dates=${rollingDateWindow()}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`World Cup provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const matches = (payload.events || []).map(normalizeEvent).filter(Boolean).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
    if (!matches.length) throw new Error('World Cup provider returned no matches in the rolling date window.');
    const value = {
      data: matches,
      freshness: new Date().toISOString(),
      source: { provider: 'ESPN World Cup scoreboard', live: true, fallback: false, url: ESPN_SCOREBOARD }
    };
    cache = { value, expiresAt: now + CACHE_MS };
    return value;
  } catch (error) {
    const value = {
      data: fallbackMatches,
      freshness: new Date().toISOString(),
      source: { provider: 'GoalGate verified schedule fallback', live: false, fallback: true, url: fallbackMatches[0].sourceUrl, error: error instanceof Error ? error.message : 'Provider unavailable' }
    };
    cache = { value, expiresAt: now + CACHE_MS };
    return value;
  }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function buildMatchInsight(match, question) {
  const home = match.metrics?.home || {};
  const away = match.metrics?.away || {};
  const homePossession = Number.isFinite(home.possessionPct) ? home.possessionPct : 50;
  const awayPossession = Number.isFinite(away.possessionPct) ? away.possessionPct : 50;
  const homeShots = Number.isFinite(home.shotsOnTarget) ? home.shotsOnTarget : 0;
  const awayShots = Number.isFinite(away.shotsOnTarget) ? away.shotsOnTarget : 0;
  const edge = clamp(0.5 + (homePossession - awayPossession) / 250 + (homeShots - awayShots) * 0.035, 0.38, 0.78);

  let signal = 'pre-match-balance';
  let summary = `${match.home} and ${match.away} are scheduled at ${match.venue || 'the listed World Cup venue'}. Live tactical metrics will appear when the match starts.`;
  if (match.status === 'live' || match.status === 'final') {
    signal = homeShots > awayShots ? 'home-chance-pressure' : awayShots > homeShots ? 'away-chance-pressure' : 'balanced-shot-quality';
    const leader = homePossession >= awayPossession ? match.home : match.away;
    const possession = Math.max(homePossession, awayPossession).toFixed(1);
    summary = `${leader} leads possession at ${possession}%. Shots on target are ${homeShots}-${awayShots} in ${match.home}'s order, indicating ${signal.replaceAll('-', ' ')}.`;
  }

  return {
    id: randomUUID(),
    matchId: match.id,
    question,
    edge: Number(edge.toFixed(2)),
    confidence: match.status === 'live' ? 0.84 : 0.66,
    signal,
    summary,
    stage: match.stage,
    sources: [match.sourceProvider || 'World Cup match feed', 'live match status', 'possession and shots-on-target model'],
    sourceUrl: match.sourceUrl,
    generatedAt: new Date().toISOString()
  };
}
