/**
 * The virtual band (RFP §7), as a pure model.
 *
 * §7 is unusually specific about what this must not be: "Members pick a spot
 * on a virtual frequency, call CQ, and others tune across the band and hear
 * signals arrive and fade by pitch. This should be built as a tuning
 * interface, not a list of available users. It is the difference between an
 * application that feels like radio and one that feels like a messaging app."
 *
 * That paragraph is a design constraint, not decoration, and it has a
 * consequence worth stating: a member must be able to MISS a station. A list
 * of available users cannot be missed — every entry is either there or not.
 * A band can be tuned past, and learning not to tune past a weak signal is a
 * real operating skill that no chat room can teach. So the model here answers
 * one question — "what does the receiver hear right now" — and everything
 * else is drawn from that.
 *
 * The arithmetic is the arithmetic of a real superhet with a CW offset:
 *
 *   heard pitch = your preferred pitch + (their frequency − your dial)
 *
 * Tune exactly onto a station and it sounds at the pitch you chose; tune 200
 * Hz low and it sounds 200 Hz high. That is why zero-beating is a skill, why
 * two stations 300 Hz apart are separable by ear, and why narrowing the
 * filter is a defence rather than a switch. The filter is centred on the
 * member's own pitch, so tuning off frequency walks a station out of the
 * passband and `filterResponse` from §6 does the attenuating — the same
 * function the band-conditions engine already uses, deliberately, so that a
 * live contact and a solo drill agree about what a 400 Hz filter does.
 *
 * Pure: no audio, no network, no DOM. A caller feeds in where the dial sits
 * and who is on the band, and gets back the pitch and level for each signal;
 * whether those come from a WebRTC peer list or a test fixture is not this
 * module's business.
 */

import { filterResponse, normalise, type BandSettings } from './band';
import type { Random } from './random';

/** A member occupying a spot, as the signalling server reports them. */
export interface Station {
  /** Peer identifier; stable for the life of the connection. */
  id: string;
  callsign: string;
  /** Where they transmit, in Hz. */
  frequencyHz: number;
  /**
   * Their signal level at this receiver, 0 to 1. The server assigns it so
   * that both ends of a contact agree about how strong each other is —
   * otherwise one member sends 599 to someone who is copying them at 339.
   */
  strength: number;
  /** Whether the key is down at this instant, for a live band display. */
  transmitting: boolean;
  /** Whether they are calling CQ rather than in a contact. */
  calling: boolean;
  /**
   * §8: a licensed callsign an administrator has not yet confirmed is on
   * the band marked as such, and no contact with it exports. Absent means
   * confirmed (training identifiers always are).
   */
  unconfirmed?: boolean;
  /**
   * §8: the profile fields "feed live contacts directly". What the member
   * chose to fill in, as they would send it; a blank field is absent. Shown
   * to anyone who can hear them, which is who would be told it on the air.
   */
  about?: StationAbout;
}

export interface StationAbout {
  name?: string;
  qth?: string;
  grid?: string;
  rig?: string;
  antenna?: string;
  licence?: string;
}

/** The slice of spectrum the band operates on. */
export interface BandPlan {
  name: string;
  startHz: number;
  endHz: number;
  /** One detent of the tuning control. */
  stepHz: number;
  /**
   * How far a member must sit from an occupied spot before calling CQ. Real
   * operators leave room; 250 Hz is about the narrowest that stays polite
   * with a 500 Hz filter.
   */
  guardHz: number;
}

/**
 * A 40 m CW segment, numbered as the real one is. Real numbers rather than
 * 0–40 000 because a member who learns to read 7 018.5 kHz here reads it on
 * their own radio later, and because "the bottom of the band is busiest" is a
 * habit worth carrying across.
 */
export const DEFAULT_BAND_PLAN: Readonly<BandPlan> = Object.freeze({
  name: '40 m CW',
  startHz: 7_000_000,
  endHz: 7_040_000,
  stepHz: 10,
  guardHz: 250,
});

export interface Receiver {
  /** What the member has the dial on, in Hz. */
  dialHz: number;
  /** Their chosen sidetone pitch — the pitch a zero-beat station sounds at. */
  pitchHz: number;
}

/** The audio range a receiver passes at all, whatever the filter is set to. */
export const AUDIO_MIN_HZ = 100;
export const AUDIO_MAX_HZ = 2500;

/** Below this share of full scale a signal is under the noise and not copyable. */
export const AUDIBLE_FLOOR = 0.02;

export interface Reception {
  station: Station;
  /** How far off the dial they are; positive means above it. */
  offsetHz: number;
  /** The pitch they sound at, in Hz. */
  audioHz: number;
  /** What the filter leaves of them, 0 to 1. */
  attenuation: number;
  /** Level at the ear: strength through the filter, 0 to 1. */
  level: number;
  /** Level against the band noise, in dB. Negative means buried. */
  snrDb: number;
  /** Whether there is anything there to copy. */
  audible: boolean;
}

const clampDial = (hz: number, plan: BandPlan): number =>
  Math.min(plan.endHz, Math.max(plan.startHz, hz));

/** Snap a frequency to the tuning step and hold it inside the band. */
export function snap(hz: number, plan: BandPlan = DEFAULT_BAND_PLAN): number {
  const stepped = Math.round(hz / plan.stepHz) * plan.stepHz;
  return clampDial(stepped, plan);
}

/** Move the dial by a number of detents. Positive tunes up the band. */
export function tune(
  dialHz: number,
  detents: number,
  plan: BandPlan = DEFAULT_BAND_PLAN,
): number {
  return snap(dialHz + detents * plan.stepHz, plan);
}

/**
 * What one station sounds like from where the dial is.
 *
 * The filter is centred on the member's own pitch, so the offset that matters
 * to it is the dial offset — which is what makes a station fade as you tune
 * away rather than vanish at an edge.
 */
export function receptionOf(
  station: Station,
  receiver: Receiver,
  band: BandSettings,
): Reception {
  const settings = normalise(band);
  const offsetHz = station.frequencyHz - receiver.dialHz;
  const audioHz = receiver.pitchHz + offsetHz;
  const attenuation = filterResponse(offsetHz, settings);
  const inAudioRange = audioHz >= AUDIO_MIN_HZ && audioHz <= AUDIO_MAX_HZ;
  const level = inAudioRange ? Math.min(1, Math.max(0, station.strength)) * attenuation : 0;

  // The noise the filter lets through, on the same scale as the signal, so
  // the member can see narrowing the filter buy them dB rather than be told.
  const noiseThrough = settings.noise * Math.sqrt(settings.filterHz / 500);
  const snrDb = noiseThrough <= 0
    ? (level > 0 ? 40 : -40)
    : Math.max(-40, Math.min(40, 20 * Math.log10(Math.max(level, 1e-6) / noiseThrough)));

  return {
    station,
    offsetHz,
    audioHz,
    attenuation,
    level,
    snrDb,
    audible: level >= AUDIBLE_FLOOR && inAudioRange,
  };
}

/**
 * Everything the receiver can hear, strongest first.
 *
 * Sorting by level rather than by frequency is deliberate: this feeds an ear,
 * not a table. The caller that draws a band display can sort by frequency
 * itself; the caller that mixes audio wants to know what dominates.
 */
export function bandScan(
  stations: readonly Station[],
  receiver: Receiver,
  band: BandSettings,
): Reception[] {
  return stations
    .map((station) => receptionOf(station, receiver, band))
    .filter((reception) => reception.audible)
    .sort((a, b) => b.level - a.level);
}

/**
 * How far the dial is from putting a station at the member's chosen pitch.
 *
 * Zero when they are zero-beat. Positive means the station is above the dial
 * and therefore sounding high. This is the number a "you are 120 Hz high"
 * prompt is built from, and the one a tuning indicator points with.
 */
export function zeroBeatError(station: Station, receiver: Receiver): number {
  return station.frequencyHz - receiver.dialHz;
}

/** Whether a spot is far enough from everyone already on the band. */
export function isClear(
  frequencyHz: number,
  stations: readonly Station[],
  plan: BandPlan = DEFAULT_BAND_PLAN,
): boolean {
  if (frequencyHz < plan.startHz || frequencyHz > plan.endHz) return false;
  return stations.every(
    (station) => Math.abs(station.frequencyHz - frequencyHz) >= plan.guardHz,
  );
}

/**
 * Find a spot to call CQ on.
 *
 * Tries at random and then falls back to a sweep, because a random pick alone
 * fails silently on a busy band and a sweep alone puts every member who ever
 * calls CQ on 7 000.0 kHz. Returns null when the band genuinely has no room,
 * which the interface should say rather than dropping someone on top of an
 * existing contact.
 */
export function clearSpot(
  stations: readonly Station[],
  random: Random,
  plan: BandPlan = DEFAULT_BAND_PLAN,
): number | null {
  const span = plan.endHz - plan.startHz;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = snap(plan.startHz + random.next() * span, plan);
    if (isClear(candidate, stations, plan)) return candidate;
  }
  for (let hz = plan.startHz; hz <= plan.endHz; hz += plan.guardHz) {
    const candidate = snap(hz, plan);
    if (isClear(candidate, stations, plan)) return candidate;
  }
  return null;
}

/**
 * The next audible signal up or down the band from where the dial sits.
 *
 * A real radio has a scan control and members will want one; the point of
 * having it here is that it returns the next SIGNAL, not the next entry in a
 * list, so a station too weak to hear is one the scan passes over exactly as
 * the ear would.
 */
export function nextSignal(
  stations: readonly Station[],
  receiver: Receiver,
  band: BandSettings,
  direction: 1 | -1,
): Station | null {
  const audible = stations.filter((station) => {
    // Judge audibility as it would be once tuned in, not from here: a station
    // outside the current passband is still worth scanning to.
    const tuned = receptionOf(station, { ...receiver, dialHz: station.frequencyHz }, band);
    return tuned.audible;
  });
  const ahead = audible
    .filter((station) => direction === 1
      ? station.frequencyHz > receiver.dialHz
      : station.frequencyHz < receiver.dialHz)
    .sort((a, b) => direction === 1
      ? a.frequencyHz - b.frequencyHz
      : b.frequencyHz - a.frequencyHz);
  return ahead[0] ?? null;
}

/** A frequency written the way an operator says it: "7 018.50 kHz". */
export function formatFrequency(hz: number): string {
  const kHz = hz / 1000;
  const [whole = '0', fraction = '00'] = kHz.toFixed(2).split('.');
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${spaced}.${fraction} kHz`;
}

/** A plain-words signal report from a level, for the band display. */
export function describeSignal(reception: Reception): string {
  if (!reception.audible) return 'nothing there';
  if (reception.snrDb > 20) return 'loud and clear';
  if (reception.snrDb > 10) return 'good copy';
  if (reception.snrDb > 3) return 'readable';
  return 'weak, in the noise';
}
