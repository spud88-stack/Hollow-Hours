# Hollow Hours

A single-player social deduction game. You and up to 20 NPCs are shut in a procedurally generated
house (or ship, or research station, or snowed-in lodge). One to three of them are murderers.
Everyone has a hidden role, nobody sees through walls, and in meetings the NPCs only know what
they personally witnessed, so what you tell them matters, whether or not it is true.

Everything is drawn and synthesized in code: there are no image or audio files.

## Run it

```bash
npm install
npm run dev
```

Then open the address Vite prints (normally http://localhost:5173).

Other commands:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck and produce a static build in `dist/` |
| `npm run sim -- --n 300` | Play 300 all-AI rounds headlessly and print win rates |
| `npm run sim -- --sweep --n 150` | The same across 20 different setting combinations |
| `npm run sim -- --n 1 --verbose` | Print one whole round, including every meeting transcript |
| `npx tsx src/sim/calibrate.ts 60 medium` | Recompute one map size of the auto-balance table (slow) |

## Controls

| Key | Action |
| --- | --- |
| `WASD` / arrows | Move |
| `E` | Use: chores, repairs, the emergency bell. Murderers and the Jester can "use" any console to pretend |
| `R` | Report a body |
| `Q` | Role action: kill (murderers), ward (Medic), shoot (Vigilante) |
| `F` | Cleaner: dispose of a body |
| `1` `2` `3` | Murderers: sabotage lights, lock doors, trigger the critical failure |
| `M` or `Tab` | Floor plan. Yellow dots are your chores |
| `Esc` | Step away from a chore |

When you are dead you become a spectator: the fog lifts, `WASD` pans, `Q`/`E` follow a
character, and `1`-`4` set the speed to 1x, 2x, 4x or 8x.

## How a round works

- Guests win by finishing every chore or voting out every murderer.
- Murderers win when they equal the remaining players, or when a critical sabotage runs out its timer.
- A reported body or the emergency bell starts a meeting: two rounds of statements, then a vote.
  A tie or a majority of skips means nobody leaves.
- You see only what your character has line of sight to. Explored areas stay visible but dimmed,
  and never show the people in them.

### Roles

| Role | Side | What it does |
| --- | --- | --- |
| Guest | Guests | Chores, eyes, a vote |
| Detective | Guests | Gets a shortlist of suspects whenever a body is reported. The killer is on it unless a Framer did the killing |
| Medic | Guests | Wards one nearby person. The ward absorbs one attack and exposes the attacker to the target and anyone watching |
| Vigilante | Guests | One bullet. Kills a murderer or the Jester; shooting an innocent guest kills the Vigilante instead. The result is announced to everyone |
| Engineer | Guests | Repairs three times faster, walks through locked doors, sees normally in a blackout |
| Lookout | Guests | 40% longer sight |
| Magistrate | Guests | Vote counts double |
| Jester | Alone | Wins only by being voted out |
| Murderer | Murderers | Kills on a cooldown, sabotages, lies |
| Cleaner | Murderers | Can make a body disappear: no report, no examination |
| Framer | Murderers | Their kills leave planted evidence, so the Detective's shortlist contains only innocents |

### Meetings

Statements are structured, not typed. On your turn you see a "What you know" box built from what
your character actually saw, then choose what to say: where you were, who you saw, an accusation
(with a reason), an alibi for someone, a contradiction of someone's claim, or a role claim.
Every option is tagged **true**, **lie** or **opinion** against your own memory, and you are free
to pick the lies. NPCs check what is said against their own memories: claim to have been in the
Library when one of them watched you leave the Kitchen and they will say so.

## Settings

NPC count (3-20), murderers (1-3, limited by head count), how many of each special role, map
theme and size, map seed, kill cooldown, vision range, chores per guest (2-14), speaking and voting
timers, NPC sharpness, preferred role, and whether roles are revealed on ejection. Invalid
combinations are clamped (for example three murderers need at least ten people). Settings are
remembered in the browser.

**Auto-balance** (on by default) sets the kill cooldown and chore count from a table measured with
all-AI rounds (`src/sim/calibrate.ts`), adjusted for which special roles are in play, aiming for
murderers to win a bit under 40% of the time. The menu shows the tested odds for the current setup
and warns when it is lopsided. That happens when there are too few murderers for the crowd: one
murderer against eleven or more guests almost never wins, and 21 people really want all three.
Moving either slider switches to manual.

**Seeds**: leave the seed blank for a new house every round. The seed used is shown on the role
card and the recap; typing it back in with the same settings rebuilds the same house and deals the
same roles.

## Design notes

Decisions I made that you might want to know about, or change:

- **NPCs only know what they saw.** Each character (including you) keeps a memory of time-stamped
  sightings: who was in view, in which room, and for how long. Suspicion, statements and votes are
  computed from that memory plus what is said aloud, never from the true game state. Murderer NPCs
  likewise only know who *they* could see when deciding whether a kill is safe or a lie is safe.
- **Personalities.** Each NPC is level-headed, trusting, paranoid, quiet, easily led or sharp,
  which changes how much they talk, how much they trust claims versus their own eyes, and how
  readily they vote. The recap shows who was what.
- **Murderer NPCs lie the way a careful player would.** They fake chores, wait for isolation, call
  off a kill if someone walks in, sometimes self-report, claim to have been in a room they really
  were in earlier, pile onto whoever the room already suspects, and occasionally make a brazen
  false eyewitness claim. Lower "sharpness" makes them sloppier and makes guests more forgetful.
- **You know the floor plan, not the people.** The `M` map shows every room from the start so that
  "Wind the clock, Library" is actionable. Fog of war hides characters and bodies, which is what
  the deduction depends on.
- **Dead guests' unfinished chores are dropped** from the house total, so a chore win stays
  possible late in a round.
- **A meeting ends any active sabotage** and clears all bodies, and unfound victims are announced
  as "missing" at the next meeting.
- **The Vigilante's shot is public** to keep its outcome from muddying NPC reasoning.
- **Among Us is the inspiration, not the template**: the names, art, roles and setting are this
  game's own.

### Code layout

- `src/sim/` is the simulation and has no DOM dependencies: `map.ts` (generation, pathfinding
  fields, line of sight), `game.ts` (rules and state), `ai.ts` (NPC behaviour), `meeting.ts`
  (statements, hearing, voting), `defs.ts` (roles, settings, balance table), `headless.ts` and
  `calibrate.ts` (test runners).
- `src/render.ts` draws the world and the fog; `src/ui.ts` is the menu, HUD, meeting and recap;
  `src/minigames.ts` and `src/audio.ts` are what they sound like; `src/main.ts` ties it together.
- All simulation randomness comes from one seeded generator, so a seed plus settings reproduces an
  all-AI round exactly. With a human playing, the house and roles are the same but events diverge
  as soon as you act differently.
