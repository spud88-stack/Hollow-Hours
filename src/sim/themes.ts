import type { MapSize } from './defs';

export type ThemeId = 'manor' | 'station' | 'ship' | 'lodge';

export interface Palette {
  void: string;
  wallTop: string;
  wallFace: string;
  wallEdge: string;
  floors: string[]; // room floor tints, picked per room
  floorLine: string;
  corridor: string;
  door: string;
  low: string;
  tall: string;
  accent: string;
  light: string; // rgb triplet for the player's light tint
}

export interface Layout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

export interface Theme {
  id: ThemeId;
  name: string;
  tagline: string;
  hub: string;
  rooms: string[];
  junctions: string[];
  tasks: string[];
  breaker: string;
  critical: string;
  criticalAlert: string;
  floorStyle: 'planks' | 'tiles' | 'plates' | 'rugs';
  corridorW: number;
  loopP: number;
  junctionP: number;
  fillMin: number; // min fraction of the available cell a room takes
  furniture: number;
  hubMerge: [number, number];
  layouts: Record<MapSize, Layout>;
  palette: Palette;
}

export const THEMES: Record<ThemeId, Theme> = {
  manor: {
    id: 'manor',
    name: 'Blackthorn Manor',
    tagline: 'Too many rooms, too many doors, too few candles.',
    hub: 'Great Hall',
    rooms: ['Library', 'Kitchen', 'Conservatory', 'Study', 'Billiard Room', 'Dining Room', 'Pantry', 'Parlour', 'Music Room', 'Trophy Room', 'Cellar', 'Nursery', 'Scullery', 'Gallery', 'Chapel', 'Smoking Room', 'Linen Room', 'Wine Vault', 'Boot Room', 'Drawing Room', 'Servants’ Hall', 'Armoury', 'Sewing Room', 'Larder', 'Attic Store', 'Observatory', 'Bath House', 'Map Room', 'Cloakroom', 'Solarium'],
    junctions: ['East Landing', 'West Landing', 'Back Stair', 'Long Gallery', 'Servants’ Passage', 'North Landing', 'Vestibule', 'Cross Passage', 'South Landing', 'Rear Lobby'],
    tasks: ['Wind the clock', 'Polish the silver', 'Sort the ledger', 'Light the lamps', 'Tune the piano', 'Stoke the fire', 'Shelve the books', 'Lay the table', 'Check the fuses', 'Water the ferns'],
    breaker: 'Fuse Cabinet',
    critical: 'Boiler',
    criticalAlert: 'The boiler is about to burst!',
    floorStyle: 'planks',
    corridorW: 1,
    loopP: 0.22,
    junctionP: 0.08,
    fillMin: 0.55,
    furniture: 0.07,
    hubMerge: [1, 1],
    layouts: {
      small: { cols: 3, rows: 3, cellW: 14, cellH: 12 },
      medium: { cols: 4, rows: 4, cellW: 14, cellH: 12 },
      large: { cols: 6, rows: 4, cellW: 14, cellH: 12 },
    },
    palette: {
      void: '#0b0806',
      wallTop: '#2b1d17',
      wallFace: '#4a2f24',
      wallEdge: '#6b4433',
      floors: ['#6e4a2f', '#5d4030', '#70523a', '#5a3a2b', '#664636'],
      floorLine: 'rgba(0,0,0,0.18)',
      corridor: '#4b3526',
      door: '#b98a4a',
      low: '#3d2619',
      tall: '#24160f',
      accent: '#d9a441',
      light: '255,214,160',
    },
  },
  station: {
    id: 'station',
    name: 'Kestrel Research Station',
    tagline: 'Four hundred miles of ice in every direction.',
    hub: 'Atrium',
    rooms: ['Cryo Lab', 'Hydroponics', 'Server Vault', 'Med Bay', 'Reactor Annex', 'Wet Lab', 'Comms Room', 'Dormitory', 'Galley', 'Core Sample Store', 'Airlock Bay', 'Workshop', 'Observation Deck', 'Chem Store', 'Gym', 'Clean Room', 'Survey Office', 'Water Plant', 'Drone Hangar', 'Archive', 'Specimen Lab', 'Laundry', 'Quarantine', 'Battery Room', 'Mud Room', 'Control Room', 'Seed Bank', 'Radio Shack'],
    junctions: ['Ring A', 'Ring B', 'Spoke North', 'Spoke South', 'Junction 4', 'Junction 7', 'Spoke East', 'Spoke West', 'Junction 2', 'Junction 9'],
    tasks: ['Calibrate sensors', 'Label samples', 'Reboot the relay', 'Check coolant', 'Log readings', 'Swap the filter', 'Align the dish', 'Restock reagents', 'Balance the centrifuge', 'Patch the firmware'],
    breaker: 'Breaker Panel',
    critical: 'Reactor Console',
    criticalAlert: 'Reactor containment is failing!',
    floorStyle: 'plates',
    corridorW: 2,
    loopP: 0.55,
    junctionP: 0.16,
    fillMin: 0.75,
    furniture: 0.05,
    hubMerge: [1, 1],
    layouts: {
      small: { cols: 3, rows: 3, cellW: 15, cellH: 13 },
      medium: { cols: 4, rows: 3, cellW: 15, cellH: 13 },
      large: { cols: 5, rows: 4, cellW: 15, cellH: 13 },
    },
    palette: {
      void: '#05080c',
      wallTop: '#1a2530',
      wallFace: '#2f4252',
      wallEdge: '#4f6b80',
      floors: ['#4a5b68', '#43545f', '#4f616c', '#3f5560', '#465a5e'],
      floorLine: 'rgba(0,0,0,0.2)',
      corridor: '#394852',
      door: '#5fd0c0',
      low: '#26343f',
      tall: '#162029',
      accent: '#5fd0c0',
      light: '200,235,255',
    },
  },
  ship: {
    id: 'ship',
    name: 'The Marguerite',
    tagline: 'A liner three days from any port.',
    hub: 'Mess Deck',
    rooms: ['Bridge', 'Engine Room', 'Cargo Hold', 'Galley', 'Chart Room', 'Captain’s Cabin', 'Boiler Flat', 'Radio Room', 'Sick Bay', 'Purser’s Office', 'Ballroom', 'Forward Hold', 'Aft Hold', 'Laundry', 'Stores', 'Crew Quarters', 'First-Class Lounge', 'Pump Room', 'Rope Locker', 'Cold Store', 'Steerage', 'Card Room', 'Chain Locker', 'Workshop', 'Smoking Saloon', 'Mail Room', 'Baggage Room', 'Promenade'],
    junctions: ['Port Gangway', 'Starboard Gangway', 'Fore Companionway', 'Aft Companionway', 'Midship Passage', 'Port Alley', 'Starboard Alley', 'Fore Passage', 'Aft Passage', 'Stairwell'],
    tasks: ['Plot the course', 'Coil the rope', 'Check the gauges', 'Sort the mail', 'Grease the winch', 'Trim the lamps', 'Count the stores', 'Send a telegram', 'Pump the bilge', 'Stow the baggage'],
    breaker: 'Switchboard',
    critical: 'Sea Valve',
    criticalAlert: 'The hold is flooding!',
    floorStyle: 'planks',
    corridorW: 2,
    loopP: 0.35,
    junctionP: 0.1,
    fillMin: 0.65,
    furniture: 0.06,
    hubMerge: [1, 1],
    layouts: {
      small: { cols: 4, rows: 2, cellW: 15, cellH: 14 },
      medium: { cols: 6, rows: 2, cellW: 15, cellH: 14 },
      large: { cols: 7, rows: 3, cellW: 15, cellH: 13 },
    },
    palette: {
      void: '#04090f',
      wallTop: '#14222e',
      wallFace: '#1f3a4d',
      wallEdge: '#b08d57',
      floors: ['#7a6248', '#6e5a44', '#806a4e', '#665340', '#74604a'],
      floorLine: 'rgba(0,0,0,0.22)',
      corridor: '#5a4a3a',
      door: '#c9a25e',
      low: '#3b2e22',
      tall: '#1c2a36',
      accent: '#c9a25e',
      light: '255,228,180',
    },
  },
  lodge: {
    id: 'lodge',
    name: 'Whitepine Lodge',
    tagline: 'The pass closed at dusk. Nobody is leaving.',
    hub: 'Common Room',
    rooms: ['Ski Store', 'Kitchen', 'Sauna', 'Bunk Room', 'Drying Room', 'Wood Store', 'Bar', 'Reading Nook', 'Games Room', 'Larder', 'Wax Room', 'Generator Shed', 'Guide’s Office', 'Laundry', 'Boot Hall', 'Loft', 'Map Room', 'First Aid Post', 'Pantry', 'Hot Tub Deck', 'Cedar Room', 'Gear Cage', 'Radio Nook', 'Smokehouse', 'Root Cellar', 'Trophy Den'],
    junctions: ['North Porch', 'South Porch', 'Back Hall', 'Covered Walk', 'Stair Foot', 'East Porch', 'West Porch', 'Breezeway', 'Side Hall', 'Mud Hall'],
    tasks: ['Stack the firewood', 'Wax the skis', 'Hang the gear', 'Radio the valley', 'Refill the lamps', 'Salt the steps', 'Chop kindling', 'Mend the snowshoes', 'Check the generator', 'Brew the cocoa'],
    breaker: 'Generator Switch',
    critical: 'Furnace',
    criticalAlert: 'The furnace is failing and the cold is coming in!',
    floorStyle: 'rugs',
    corridorW: 1,
    loopP: 0.4,
    junctionP: 0.12,
    fillMin: 0.6,
    furniture: 0.06,
    hubMerge: [2, 1],
    layouts: {
      small: { cols: 4, rows: 3, cellW: 13, cellH: 12 },
      medium: { cols: 4, rows: 4, cellW: 14, cellH: 12 },
      large: { cols: 6, rows: 4, cellW: 14, cellH: 13 },
    },
    palette: {
      void: '#dfe8ee',
      wallTop: '#3a2a1e',
      wallFace: '#5c4330',
      wallEdge: '#7d5d43',
      floors: ['#8a6a48', '#7c5e42', '#90704e', '#75583e', '#836446'],
      floorLine: 'rgba(0,0,0,0.16)',
      corridor: '#6a5038',
      door: '#d8b26a',
      low: '#4a3423',
      tall: '#2d1f15',
      accent: '#e0703a',
      light: '255,205,150',
    },
  },
};

export const THEME_IDS: ThemeId[] = ['manor', 'station', 'ship', 'lodge'];
