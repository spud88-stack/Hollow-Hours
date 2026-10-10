# Build prompt: top-down social deduction game

I want you to build a complete, polished single-player social deduction game in this folder (it's empty right now). Think of the Among Us formula, but played alone against up to 20 NPCs who each have a hidden role, with its own theme, name, and look rather than a clone of that game's art or terminology. This is a personal project I want to actually enjoy playing, so I care more about the game feeling alive and replayable than about any one feature on a checklist. You have a lot of creative freedom here, and I'd like you to use it.

## The game

A round drops the player and the NPCs into a procedurally generated map. Most characters are civilians who need to finish tasks and survive. One to three are murderers who need to kill quietly and avoid suspicion. When a body is reported or someone calls an emergency meeting, everyone gathers, shares what they saw, and votes someone out. Civilians win by completing all tasks or eliminating every murderer; murderers win when they equal or outnumber the rest, or when a critical sabotage runs out its timer.

The player is assigned a role at random each round (with an option in settings to pick a preferred one), and every role must be fully playable by the player: ordinary civilian, any special role, or murderer.

The view is top-down 2D with fog of war. The player only sees what their character has line of sight to, walls block vision, and areas they've explored but can't currently see are shown dimmed without the characters in them. This matters a lot: the whole game is about incomplete information, so vision should feel tense and fair.

## Roles

Design a roster of roles on top of the plain civilian and plain murderer. I have a few in mind as starting points: a detective who can examine bodies or scenes for clues, a medic who can protect or save someone, a vigilante with a single risky kill, an engineer who is good at countering sabotage, and at least one neutral role with its own win condition (a jester who wants to be voted out is the classic). Add, drop, or change these as you see fit. The test for a good role is that it changes how you play and gives out information that is useful but never conclusive on its own. Give murderers a couple of variants too, so being the murderer isn't the same every round.

## Settings

Before a round, the player can configure NPC count (up to 20), murderer count (1 to 3), which special roles are enabled and how many, map theme and size, a map seed (blank for random, so a good map can be replayed or shared), kill cooldown, vision range, task count, and meeting/voting timers. Give sensible defaults and prevent invalid combinations, such as three murderers among four characters. Remember the settings between sessions.

## Maps

Maps are generated fresh from a seed, and I want real variety: several distinct themes (for example a manor, a research station, a ship, a snowed-in lodge; pick your own set), each with its own room types, palette, tasks, and layout tendencies. Every generated map has to be fully connected, with a mix of open rooms, corridors, dead ends, and loops, so there are both safe-feeling places and dangerous ones. Rooms should be named, since characters will refer to locations during meetings.

## The hard parts

These are where I expect a quick implementation to fall flat, so please put your effort here.

**NPCs must only know what they witnessed.** Each NPC should keep its own memory of what it actually saw through its own line of sight: who was where and when, who was with whom, who it saw near a body, who it saw doing tasks. Its suspicions, statements, and votes should come from that memory, not from the true game state. An NPC that magically knows the murderer, or votes at random, ruins the game. Give NPCs some personality variation too (trusting, paranoid, quiet, a follower) so meetings don't all play out the same way.

**NPC murderers have to play deceptively.** They should fake tasks, avoid killing in front of witnesses, build alibis, sometimes self-report, lie in meetings in ways that are plausible given what others could have seen, and occasionally get caught in a lie. They should be beatable through reasoning, not through luck.

**Meetings need to work without free-text chat.** Since this is single player, design a structured discussion: characters make statements like where they were, who they saw, who they suspect and why, or a role claim, and the player contributes by choosing from statements generated from their own actual experience, plus the option to lie, which is essential when the player is the murderer. NPCs should respond to what's said, including to the player's accusations and to contradictions between statements. This is the heart of the game, so make it readable and quick to use.

**Playing as the murderer should be as good as playing civilian.** NPC civilians need to be capable of catching the player: noticing them leaving a room where a body is found, remembering inconsistencies, and reacting to weak alibis.

## Extras

Add features you think make the game better. Ideas I like: sabotages (lights out that shrinks vision, locked doors, a critical one on a timer), short task minigames instead of hold-to-complete bars, physical evidence left at scenes, a spectator mode after death with fast-forward so the player can watch the round resolve, an end-of-round recap that reveals all roles and replays the key moments, and difficulty levels that change how sharp the NPCs are. Use your judgment on what earns its place.

## Technical direction

Build it as a browser game in TypeScript with HTML5 Canvas, using Vite, so I can run it locally with one command on Windows. Draw everything in code (shapes, procedural sprites, lighting, particles) rather than depending on external art or audio files; synthesized sound effects through Web Audio are welcome. Keep the simulation logic separate from rendering, and make all randomness flow from the seed so rounds are reproducible.

That separation also gives you a way to check your own work: build a headless mode that runs full rounds with every character controlled by AI, and use it to run hundreds of rounds across many seeds and settings. Look for crashes, stuck characters, unreachable tasks, rounds that never end, and lopsided win rates between sides, and tune until neither side wins overwhelmingly at default settings. Then play it in a real browser as each kind of role and fix what feels bad, since balance numbers won't tell you whether fog of war looks right or meetings are confusing.

## How to work

This is a large build, so work in stages that each leave the game runnable, starting from movement on a generated map with fog of war and growing from there. Initialize a git repository and commit as you go. Make the design decisions yourself rather than stopping to ask me about them; I'd rather react to a working game than answer questions up front. Keep a short README covering how to run it, the controls, the roles, and the notable design choices you made.

When you're done, tell me plainly what works, what you tested and how, and anything that is rough or unfinished.
