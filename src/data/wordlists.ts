/**
 * Content data files. RFP §4 needs word and plain-text drills; RFP §6 needs
 * robot QSO slot values "drawn from a data file the operator can edit without a
 * code change". These are plain exported arrays for that reason — a project
 * administrator can edit this one file.
 */

/** The 100 most common words on the air, shortest first. */
export const COMMON_WORDS: readonly string[] = [
  'DE', 'UR', 'RST', 'QTH', 'OP', 'PSE', 'TNX', 'FB', 'HR', 'ES',
  'WX', 'RIG', 'ANT', 'PWR', 'AGN', 'QRS', 'QRQ', 'QRM', 'QRN', 'QSB',
  'QSL', 'QRZ', 'CQ', 'K', 'KN', 'SK', 'AR', 'BT', 'TU', 'GM',
  'GA', 'GE', 'OM', 'YL', 'XYL', 'HW', 'CPY', 'SRI', 'NAME', 'CALL',
  'THE', 'AND', 'FOR', 'ARE', 'YOU', 'WAS', 'HIS', 'HER', 'ONE', 'TWO',
  'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HOW', 'ITS', 'NEW', 'NOW', 'OLD',
  'SEE', 'TWO', 'WAY', 'WHO', 'BOY', 'DID', 'MAN', 'MEN', 'PUT', 'SAY',
  'SHE', 'TOO', 'USE', 'HERE', 'THAT', 'WITH', 'HAVE', 'THIS', 'WILL',
  'YOUR', 'FROM', 'THEY', 'KNOW', 'WANT', 'BEEN', 'GOOD', 'MUCH', 'SOME',
  'TIME', 'VERY', 'WHEN', 'COME', 'JUST', 'LIKE', 'LONG', 'MAKE', 'OVER',
  'SUCH', 'TAKE', 'THAN', 'WELL', 'WORK',
];

/** Plain-text practice passages, kept short enough for one drill. */
export const PLAIN_TEXT: readonly string[] = [
  'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG',
  'GOOD MORNING AND THANKS FOR THE CALL OM',
  'THE WEATHER HERE IS FINE WITH LIGHT WIND FROM THE WEST',
  'MY RIG IS RUNNING FIVE WATTS TO A WIRE ANTENNA',
  'I HAVE BEEN ON THE AIR FOR THREE YEARS NOW',
  'SORRY FOR THE POOR FIST I AM STILL LEARNING',
  'THE BAND IS IN GOOD SHAPE THIS EVENING',
  'PLEASE REPEAT YOUR NAME AND QTH AGAIN',
];

/** Callsign prefixes, weighted toward what a member will actually hear. */
export const CALL_PREFIXES: readonly string[] = [
  'A6', 'A4', 'A9', 'EP', 'EK', 'G', 'GM', 'GW', 'M0', 'M7', 'F', 'DL', 'DK',
  'I', 'IK', 'IZ', 'EA', 'CT', 'ON', 'PA', 'OZ', 'SM', 'LA', 'OH', 'SP',
  'OK', 'HA', 'YO', 'LZ', 'SV', 'TA', '4X', 'UA', 'RA', 'UR', 'K', 'W', 'N',
  'AA', 'KC', 'VE', 'VA', 'VK', 'ZL', 'JA', 'JH', 'BY', 'HL', 'YB', 'VU',
  '9V', '9M', 'HS', 'ZS', '5Z', 'SU', 'CN', 'PY', 'LU', 'CE', 'HK',
];

/** Robot QSO slot values (RFP §6) — operator-editable. */
/**
 * Stations the robot can be, kept coherent.
 *
 * A callsign carries a country, and a student copying one is learning to
 * place it. EA3 is Spain; a station with that call is not called LUIGI and
 * does not live in OSLO. Drawing the prefix, the name and the town from three
 * separate hats taught members an association that is wrong on the air, so
 * they are drawn together from here instead.
 *
 * Names are given names ordinary in that country, towns are towns operators
 * there actually give as their QTH, and everything is plain A–Z because that
 * is the alphabet Morse has.
 */
export interface RobotStation {
  /** Callsign prefix. It is what fixes the country. */
  prefix: string;
  qth: readonly string[];
  names: readonly string[];
}

export const ROBOT_STATIONS: readonly RobotStation[] = [
  { prefix: 'G4', qth: ['LONDON', 'BRISTOL', 'YORK', 'LEEDS'], names: ['JOHN', 'DAVE', 'PAUL', 'SARAH'] },
  { prefix: 'M0', qth: ['CARDIFF', 'NORWICH', 'BATH'], names: ['BOB', 'STEVE', 'HELEN'] },
  { prefix: 'DL1', qth: ['MUNICH', 'BERLIN', 'HAMBURG', 'DRESDEN'], names: ['HANS', 'KLAUS', 'PETER', 'ANNA'] },
  { prefix: 'F5', qth: ['PARIS', 'LYON', 'NANTES', 'BREST'], names: ['PIERRE', 'MICHEL', 'JEAN', 'MARIE'] },
  { prefix: 'I2', qth: ['ROMA', 'MILANO', 'TORINO', 'NAPOLI'], names: ['LUIGI', 'MARCO', 'PAOLO', 'ELENA'] },
  { prefix: 'EA3', qth: ['BARCELONA', 'MADRID', 'VALENCIA', 'BILBAO'], names: ['PEDRO', 'JOSE', 'CARLOS', 'MARIA'] },
  { prefix: 'SM5', qth: ['STOCKHOLM', 'UPPSALA', 'MALMO'], names: ['LARS', 'ERIK', 'SVEN'] },
  { prefix: 'LA2', qth: ['OSLO', 'BERGEN', 'TROMSO'], names: ['OLAV', 'BJORN', 'INGRID'] },
  { prefix: 'OH2', qth: ['HELSINKI', 'TAMPERE', 'TURKU'], names: ['JUHA', 'MIKKO', 'PEKKA'] },
  { prefix: 'VE3', qth: ['TORONTO', 'OTTAWA', 'CALGARY'], names: ['DAVE', 'BOB', 'JEAN'] },
  { prefix: 'W1', qth: ['BOSTON', 'DENVER', 'DALLAS', 'SEATTLE'], names: ['JIM', 'TOM', 'BILL', 'LISA'] },
  { prefix: 'JA1', qth: ['TOKYO', 'OSAKA', 'KYOTO', 'SAPPORO'], names: ['YUKI', 'HIRO', 'KENJI', 'TARO'] },
  { prefix: 'VK4', qth: ['BRISBANE', 'SYDNEY', 'PERTH'], names: ['BRUCE', 'GREG', 'KATE'] },
  { prefix: 'ZL1', qth: ['AUCKLAND', 'WELLINGTON'], names: ['IAN', 'DAVE'] },
  { prefix: 'A65', qth: ['DUBAI', 'ABU DHABI', 'SHARJAH'], names: ['AHMED', 'OMAR', 'KHALID'] },
  { prefix: 'A41', qth: ['MUSCAT', 'SALALAH', 'SOHAR'], names: ['SAID', 'NASSER', 'HAMED'] },
  { prefix: 'SU1', qth: ['CAIRO', 'ALEXANDRIA'], names: ['MOHAMED', 'HASSAN'] },
  { prefix: 'VU2', qth: ['MUMBAI', 'DELHI', 'CHENNAI'], names: ['RAJ', 'ARUN', 'SUNIL'] },
];

export const ROBOT_RIGS: readonly string[] = [
  'IC 7300', 'FT 991', 'TS 590', 'K3', 'KX2', 'KX3', 'X6100', 'FT 817',
  'IC 705', 'TS 890', 'HOMEBREW', 'QCX', 'FT 710', 'IC 7610',
];

export const ROBOT_ANTENNAS: readonly string[] = [
  'DIPOLE', 'VERTICAL', 'END FED', 'YAGI', 'LOOP', 'LONG WIRE', 'INV V',
  'HEX BEAM', 'MAG LOOP', 'GP', 'WINDOM', 'EFHW',
];

export const ROBOT_WEATHER: readonly string[] = [
  'SUNNY 32C', 'HOT 41C', 'CLOUDY 18C', 'RAIN 12C', 'WINDY 15C', 'FOG 8C',
  'CLEAR 22C', 'SNOW MINUS 3C', 'HUMID 29C', 'COOL 14C',
];
