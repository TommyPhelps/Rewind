// REWIND reference data — hand-compiled by Claude on 2026-10-16 for the games in Tommy's
// library that the old REWIND table didn't cover, plus extra "trait" tags for well-known
// games that already had genre tags.
//
// These are general-knowledge ESTIMATES, not verified metadata. Everywhere they appear
// REWIND labels them "REWIND reference (unverified estimate)", they only ever fill fields
// that are still unknown, and anything you edit yourself wins. Titles I wasn't confident
// about are deliberately left out and stay "unknown".
//
// Line format:  Title | tags | players | scale
//   players: S single-player · O single-player, online-leaning · C co-op focused ·
//            M multiplayer required · T tool / not a game · (blank) unknown
//   scale:   S short (<12h) · M medium (12-35h) · L long (35h+) · E endless · (blank) unknown
// Lines starting with "+" only ADD trait tags to a game that already has genre tags.
//
// Trait tags used by the recommender (see src/rec/traits.ts):
//   guided, aimless, grind, dialogue, punishing, gentle, mastery, quicksession,
//   setup, tense, weird, retro, social, tactics, programming, mmo, pvp, coop

export const REFERENCE_VERSION = 1;

export const REFERENCE_TXT = `
A Hat in Time|platformer,comedy,cozy,gentle,guided,quicksession|S|S
ADOM (Ancient Domains Of Mystery)|roguelike,rpg,retro,punishing,setup,turnbased|S|E
ARK: The Survival Of The Fittest|survival,pvp|M|E
Abiotic Factor|survival,crafting,scifi,comedy,building,exploration,coop|C|L
Absolver|action,mastery,punishing,pvp|O|S
Acceleration of SUGURI 2|arcade,quicksession,pvp|O|S
Age of Conan: Unchained|mmo,rpg,fantasy,grind|O|E
Age of Wonders III|4x,strategy,fantasy,turnbased,setup|S|E
Aliens: Fireteam Elite|shooter,scifi,horror,coop|C|M
Amnesia: A Machine for Pigs|horror,story,atmospheric,walking,tense|S|S
Arma 3|fps,sim,tactics,setup,punishing|O|E
Assassin's Creed Black Flag Resynced|action,openworld,adventure,stealth,exploration,grind|S|L
BPM: BULLETS PER MINUTE|fps,roguelike,mastery,punishing,quicksession|S|S
Barotrauma|sim,survival,scifi,setup,tense,coop|C|E
Battle Chef Brigade Deluxe|puzzle,action,cozy,story,comedy|S|S
Bear With Me - Collector's Edition|adventure,mystery,detective,story,dialogue|S|S
Blackwake|shooter,pvp|M|E
Bloons TD 6|strategy,quicksession,gentle,cozy|S|E
Bots Are Stupid|puzzle,programming,quicksession|S|S
Broforce|action,platformer,arcade,comedy,quicksession|S|S
Bunker Punks|fps,roguelike,quicksession|S|S
Call of Duty: Black Ops II - Zombies|shooter,arcade,coop|C|E
Call of Duty®|fps,pvp|M|E
Call of Duty®: Black Ops II|fps,shooter,story,action,guided|S|S
Call of Duty®: Modern Warfare® 2 (2009)|fps,shooter,story,action,guided,retro|S|S
Carrier Command 2|sim,strategy,setup|O|E
Carrier Command 2 VR|sim,strategy,setup|O|E
Chained Together|platformer,punishing,coop|M|S
Chivalry: Medieval Warfare|action,pvp|M|E
Clair Obscur: Expedition 33|rpg,story,turnbased,fantasy,atmospheric,guided,mastery,dialogue|S|L
Company of Heroes 2|rts,strategy,story|S|M
Conan Exiles - Public Beta Client||T|
Conan Exiles Enhanced|survival,crafting,building,sandbox,fantasy,grind,aimless|O|E
Core Keeper|sandbox,crafting,exploration,cozy,building,grind|S|E
Counter-Strike|fps,pvp,retro|M|E
Counter-Strike: Condition Zero|fps,retro|O|S
Counter-Strike: Source|fps,pvp|M|E
Crimson Desert Enhanced|action,openworld,fantasy,exploration,story|S|L
CrossCode|rpg,action,puzzle,retro,story,guided,mastery|S|L
Cultist Simulator|cards,strategy,narrative,weird,setup,aimless|S|M
DEFCON|strategy,rts,weird,quicksession|O|S
Dale & Dawson Stationery Supplies|social,pvp|M|E
Dandara: Trials of Fear Edition|metroidvania,platformer,punishing,mastery|S|S
Darksiders II Deathinitive Edition|action,hack,rpg,adventure,guided,exploration|S|M
Darwinia|rts,strategy,weird,retro|S|S
Day of Defeat|fps,pvp,retro|M|E
Day of Defeat: Source|fps,pvp|M|E
Dead Island Definitive Edition|action,survival,openworld,horror,grind|O|L
Dead by Daylight|horror,pvp|M|E
Deadlock|pvp|M|E
Deathmatch Classic|fps,pvp,retro|M|E
DiRT Rally|racing,driving,sim,mastery,punishing|S|E
Duck Game|arcade,pvp|M|E
Due Process|tactics,shooter,pvp|M|E
Dungeons 3|strategy,management,comedy,building|S|M
ELDEN RING NIGHTREIGN|souls,action,roguelike,punishing,coop|C|E
Eco|survival,building,sim,setup,grind,coop|C|E
Escape Simulator|puzzle,quicksession|S|S
Euro Truck Simulator|driving,sim,relaxing,cozy,aimless|S|E
Evolve Stage 2|shooter,pvp|M|E
FOREWARNED|horror,coop|M|E
Figment|adventure,puzzle,story,weird,gentle|S|S
Forged Battalion|rts,strategy|O|M
Forts|rts,strategy,building|O|M
Foxhole|mmo,pvp,grind|M|E
Fractured Space|space,pvp|M|E
From Glory To Goo|strategy,survival|S|M
GOAT OF DUTY|fps,comedy,pvp|M|E
GameMaker: Studio||T|
Garfield Kart - Furious Racing|racing,arcade,gentle|O|S
Garry's Mod|sandbox,building,aimless|O|E
Gloomhaven|tactics,strategy,cards,fantasy,punishing,setup,turnbased|S|L
GoNNER|platformer,roguelike,punishing,quicksession,arcade|S|S
Goat Simulator|comedy,sandbox,weird,aimless,quicksession|S|S
Grand Theft Auto V Enhanced|action,openworld,crime,story,driving|O|L
Grand Theft Auto V Legacy|action,openworld,crime,story,driving|O|L
Grow Up|platformer,exploration,cozy,gentle|S|S
Guns of Icarus Online|pvp,coop|M|E
HAWKEN|shooter,pvp|M|E
HITMAN™|stealth,puzzle,mastery,guided,sandbox|S|M
Hacknet|puzzle,programming,story,weird|S|S
Half-Life Deathmatch: Source|fps,pvp|M|E
Happy Room|comedy,sandbox,quicksession,weird|S|S
Hard Reset Extended Edition|fps,action,scifi|S|S
Hard Reset Redux|fps,action,scifi|S|S
Hell Let Loose|fps,tactics,pvp|M|E
Hidden Folks|puzzle,cozy,relaxing,gentle,quicksession,weird|S|S
How to Survive|survival,action,crafting|O|M
Hunt: Showdown 1896|fps,horror,tense,punishing,pvp|M|E
Hunt: Showdown 1896 (Test Server)||T|
I am not a Monster: First Contact|tactics,turnbased,scifi|O|M
Immortal Redneck|fps,roguelike,action|S|M
Injustice: Gods Among Us Ultimate Edition|action,story,quicksession|S|S
Insurgency|fps,tactics,pvp|M|E
Insurgency: Sandstorm|fps,tactics,pvp|M|E
Interplanetary|strategy,turnbased,space|O|S
Jotun: Valhalla Edition|action,exploration,atmospheric,punishing,story|S|S
Just Act Natural|social,pvp|M|E
Just Cause 2|action,openworld,sandbox,shooter,driving,aimless|S|M
Just Cause™ 3|action,openworld,sandbox,shooter,driving,aimless|S|M
Ken Follett's The Pillars of the Earth|adventure,narrative,story,dialogue,walking|S|M
Kingdom: Classic|strategy,building,retro,quicksession,weird|S|M
Kona|adventure,mystery,exploration,atmospheric,survival|S|S
KovaaK's||T|
LEGO® Batman™ 3: Beyond Gotham|action,platformer,comedy,cozy,gentle,guided|S|M
LEGO® Batman™: Legacy of the Dark Knight|action,platformer,comedy,cozy,gentle,guided|S|M
LEGO® DC Super-Villains|action,platformer,comedy,cozy,gentle,guided|S|M
LEGO® Marvel™ Super Heroes|action,platformer,comedy,cozy,gentle,guided|S|M
LEGO® Star Wars™: The Skywalker Saga|action,platformer,comedy,cozy,gentle,guided,scifi|S|M
LEGO® The Lord of the Rings™|action,platformer,comedy,cozy,gentle,guided,fantasy|S|M
Lemnis Gate|fps,strategy,pvp|M|E
Lethal League|arcade,quicksession,pvp|O|S
Loadout|shooter,pvp|M|E
Lords Of The Fallen™ 2014|souls,action,fantasy,punishing,mastery|S|M
Lost Ark|mmo,rpg,action,grind|O|E
MageQuit|arcade,pvp|M|E
Marvel Rivals|shooter,pvp|M|E
Marvel's Spider-Man 2|action,openworld,story,guided,exploration|S|M
Minit|adventure,retro,puzzle,quicksession,weird,gentle|S|S
Monster Train|cards,roguelike,strategy,quicksession,mastery|S|E
Mount Your Friends|comedy,pvp|M|E
Multiwinia|rts,strategy,weird|O|S
Mutant Year Zero: Road to Eden|tactics,turnbased,stealth,story,postapoc,guided|S|M
My Summer Car|sim,driving,survival,punishing,setup,aimless,weird|S|E
Natural Selection 2|fps,rts,pvp|M|E
NeuroVoider|shooter,roguelike,arcade,quicksession|S|S
New World: Aeternum|mmo,rpg,action,openworld,grind|O|E
NieR Replicant™ ver.1.22474487139...|rpg,action,story,fantasy,weird,grind|S|L
Nioh 2 – The Complete Edition|souls,action,mastery,punishing,grind|S|L
Old Man's Journey|puzzle,adventure,story,relaxing,cozy,gentle,quicksession|S|S
Orcs Must Die! 2|strategy,action,comedy|O|M
Overlord™|action,strategy,comedy,fantasy|S|M
PAYDAY™ The Heist|fps,crime,coop|C|M
PEAK|comedy,coop|C|S
PGA TOUR 2K21|sports,sim,relaxing|S|E
PICO PARK|puzzle,coop|M|S
Pacific Drive|survival,driving,crafting,exploration,atmospheric,grind,tense|S|L
Pathologic Classic HD|survival,horror,narrative,weird,punishing,dialogue,tense|S|L
Pavlov|fps,pvp|M|E
PlateUp!|management,cozy,roguelike,quicksession,coop|C|E
Plunder Panic|arcade,pvp|M|E
Portal Knights|sandbox,rpg,crafting,cozy,building,grind|S|L
Predator: Hunting Grounds|shooter,pvp|M|E
Project CARS 2|racing,driving,sim,mastery|S|E
Project Winter|survival,social,pvp|M|E
Q.U.B.E. 2|puzzle,story,scifi,guided|S|S
Quake Champions|fps,pvp|M|E
Quiplash|comedy,social|M|E
Rampage Knights|action,hack,roguelike|O|S
Ratchet & Clank: Rift Apart|action,platformer,shooter,story,guided,gentle|S|M
Red Dead Redemption|action,openworld,western,story,guided|S|L
Regions Of Ruin|rpg,strategy,building,fantasy|S|M
Resident Evil 0|survivalhorror,horror,puzzle,story,retro,tense|S|M
Resident Evil Re:Verse|shooter,horror,pvp|M|E
Resident Evil Revelations|survivalhorror,horror,action,story,guided,tense|S|M
Ricochet|pvp,retro|M|E
S.T.A.L.K.E.R.: Call of Prypiat - Enhanced Edition|fps,postapoc,openworld,survival,atmospheric,tense,punishing|S|M
S.T.A.L.K.E.R.: Shadow of Chornobyl - Enhanced Edition|fps,postapoc,openworld,survival,atmospheric,tense,punishing|S|M
SCP: Containment Breach Multiplayer|horror,pvp|M|E
SCUM|survival,openworld,grind,setup,aimless|O|E
SHENZHEN I/O|puzzle,programming,setup,weird|S|M
STAR WARS™ Battlefront II (Classic|shooter,action,retro|S|M
STARWHAL|arcade,pvp|M|E
Satellite Reign|tactics,strategy,scifi,stealth,openworld|S|M
Schedule I|sim,crime,management,grind,comedy|O|L
Screencheat|fps,pvp|M|E
Scribble It!|social|M|E
Serial Cleaner|stealth,arcade,quicksession,retro|S|S
Seven: Enhanced Edition|rpg,stealth,openworld,scifi|S|M
She Remembered Caterpillars|puzzle,relaxing,gentle,story|S|S
ShellShock Live|arcade,pvp|M|E
Shelter|survival,cozy,atmospheric,gentle,quicksession|S|S
Shiness: The Lightning Kingdom|rpg,action,fantasy,story|S|M
Sniper Elite|shooter,stealth,guided|S|S
Sniper Elite V2|shooter,stealth,guided|S|S
Sonic & SEGA All-Stars Racing|racing,arcade|O|S
Splitgate|fps,pvp|M|E
Squad|fps,tactics,pvp|M|E
Squad - Public Testing||T|
Star Trek Online|mmo,space,scifi,rpg,grind|O|E
Star Wars Outlaws|action,openworld,scifi,stealth,story|S|L
Stationeers|survival,building,sim,scifi,setup,punishing,aimless|O|E
Staxel|sandbox,farming,cozy,building,relaxing|S|E
Steep Open Beta||T|
Stick Fight: The Game|arcade,pvp|M|E
Stolen Realm|rpg,tactics,turnbased,fantasy|O|M
Stormworks: Build and Rescue|sandbox,building,sim,setup,aimless|O|E
Strange Brigade|shooter,adventure|O|M
Styx: Shards of Darkness|stealth,action,fantasy,mastery|S|M
Sudden Strike 4|rts,strategy|S|M
Super Animal Royale|pvp|M|E
Super Crate Box|arcade,quicksession,punishing,retro|S|E
Survivor Squad|tactics,survival,roguelike|S|S
TIS-100|puzzle,programming,setup,weird,punishing|S|M
Tabletop Simulator|social,pvp|M|E
Tales of Berseria™|rpg,story,action,fantasy,dialogue,guided|S|L
Team Fortress Classic|fps,pvp,retro|M|E
Terrorhedron Tower Defense|strategy|S|S
The Dwarves|rpg,tactics,story,fantasy|S|M
The Escapists 2|puzzle,sim,crafting,comedy|O|M
The Incredible Adventures of Van Helsing: Final Cut|rpg,hack,action,grind|S|L
The Long Drive|driving,survival,sandbox,aimless,weird|S|E
The Planet Crafter|survival,building,crafting,exploration,scifi,cozy,guided|S|L
The Signal From Tölva|fps,exploration,scifi,atmospheric|S|M
The Surge|souls,action,scifi,punishing,mastery|S|M
The Surge 2|souls,action,scifi,punishing,mastery|S|M
The Survivalists|survival,crafting,building,cozy|O|M
Thief Gold (1999)|stealth,retro,mastery|S|M
Tiny Rogues|roguelike,action,quicksession,punishing,retro|S|E
Tom Clancy's Ghost Recon Phantoms - NA|shooter,pvp|M|E
Tom Clancy's Ghost Recon® Breakpoint|shooter,openworld,tactics,grind|O|L
Tom Clancy's Ghost Recon® Wildlands|shooter,openworld,tactics,grind|O|L
Tom Clancy’s The Division™|shooter,openworld,rpg,grind|O|L
Total War: SHOGUN 2|strategy,rts,setup|S|E
Totally Accurate Battlegrounds|comedy,pvp|M|E
Turing Complete|puzzle,programming,setup|S|L
ULTRAKILL|fps,action,mastery,punishing,retro,quicksession|S|M
Ultimate Chicken Horse|platformer,pvp|M|E
Ultimate Epic Battle Simulator|sandbox,sim,aimless,weird,quicksession|S|E
Unfortunate Spacemen|social,space,pvp|M|E
Unrailed!|arcade,coop|C|E
Unturned|survival,sandbox,crafting,grind|O|E
Uplink|puzzle,strategy,retro,weird|S|M
V Rising|survival,action,crafting,building,grind,fantasy|O|L
Viscera Cleanup Detail|sim,relaxing,weird,comedy,aimless|O|M
Viscera Cleanup Detail: Santa's Rampage|sim,relaxing,weird,comedy,aimless|O|S
Viscera Cleanup Detail: Shadow Warrior|sim,relaxing,weird,comedy,aimless|O|S
Walkabout Mini Golf VR|sports,relaxing|O|S
Wallpaper Engine||T|
We Were Here Too|puzzle,coop|M|S
Wizard of Legend|roguelike,action,mastery,quicksession|S|E
Yooka-Laylee|platformer,exploration,comedy,cozy,gentle|S|M
Zombie Army Trilogy|shooter,horror|O|M
Zombie Night Terror|puzzle,strategy,comedy,quicksession|S|S
observer_|horror,story,scifi,walking,tense,weird|S|S
tModLoader||T|

+STAR WARS™ Knights of the Old Republic™|dialogue,guided,retro
+STAR WARS™ Knights of the Old Republic™ II - The Sith Lords™|dialogue,guided,retro
+The Witcher: Enhanced Edition Director's Cut|dialogue,guided,retro
+The Witcher 2: Assassins of Kings Enhanced Edition|dialogue,guided
+The Witcher 3: Wild Hunt — Remastered|dialogue,guided,exploration
+Persona 4 Golden|dialogue,guided,social
+Mass Effect™ Legendary Edition|dialogue,guided
+Baldur's Gate 3|dialogue,guided,tactics
+Divinity: Original Sin 2 - Definitive Edition|dialogue,tactics,punishing,setup
+Disco Elysium - The Final Cut|dialogue,weird,gentle
+Cyberpunk 2077|dialogue,guided,exploration
+Kingdom Come: Deliverance|dialogue,punishing,setup,grind
+NieR:Automata™|weird,guided
+Detroit: Become Human|dialogue,gentle
+Undertale|weird,dialogue
+Yakuza 0|dialogue,guided,weird
+Fallout: New Vegas|dialogue,exploration
+Fallout 3: Game of the Year Edition|dialogue,exploration
+Fallout 4|exploration,grind
+The Elder Scrolls III: Morrowind® Game of the Year Edition|exploration,retro,setup
+The Elder Scrolls IV: Oblivion® Game of the Year Edition (2009)|exploration
+The Elder Scrolls V: Skyrim|exploration
+Hogwarts Legacy|guided,exploration,gentle
+ELDEN RING|punishing,mastery,exploration
+DARK SOULS™: REMASTERED|punishing,mastery
+DARK SOULS™ II: Scholar of the First Sin|punishing,mastery
+DARK SOULS™ III|punishing,mastery
+Sekiro™: Shadows Die Twice - GOTY Edition|punishing,mastery,guided
+STAR WARS Jedi: Fallen Order™|guided,mastery
+STAR WARS Jedi: Survivor™|guided,mastery
+Hollow Knight|punishing,mastery,exploration
+Ori and the Blind Forest|mastery,guided
+Ori and the Will of the Wisps|mastery,guided
+Hyper Light Drifter|punishing,mastery,weird
+Outer Wilds|weird,gentle
+Kenshi|aimless,grind,punishing,setup
+Project Zomboid|aimless,grind,punishing,setup,tense
+7 Days to Die|aimless,grind
+Valheim|grind,exploration
+Terraria|grind,exploration,mastery
+Factorio|setup,mastery
+RimWorld|setup
+Mount & Blade: Warband|aimless,grind,setup
+No Man's Sky|aimless,grind
+Stranded Deep|grind,aimless
+Hearts of Iron IV|setup,punishing
+Sid Meier's Civilization® V|setup
+Stellaris|setup
+Kerbal Space Program|setup,mastery,punishing
+Balatro|quicksession,mastery
+Slay the Spire|quicksession,mastery
+Vampire Survivors|quicksession,gentle
+Risk of Rain 2|quicksession,mastery
+Noita|punishing,quicksession,weird
+Spelunky 2|punishing,quicksession,mastery
+Enter the Gungeon|punishing,quicksession
+Inscryption|weird,guided
+Cult of the Lamb|guided
+Portal|guided,quicksession,gentle
+Portal 2|guided,gentle
+DEATH STRANDING|weird,grind,exploration
+God of War|guided,mastery
+Ghost of Tsushima DIRECTOR'S CUT|exploration,guided
+Marvel’s Spider-Man Remastered|guided,gentle
+Marvel’s Spider-Man: Miles Morales|guided,gentle
+Tomb Raider Game of the Year|guided
+Rise of the Tomb Raider™|guided
+The Last of Us™ Part I|guided,tense
+Metro 2033|guided,tense
+Metro: Last Light Redux|guided,tense
+Metro Exodus|guided,tense
+BioShock™|guided
+BioShock® 2|guided
+BioShock Infinite|guided
+Dishonored|mastery,guided
+Deus Ex: Game of the Year Edition|retro
+Prey|weird,tense
+Pathologic 2|punishing,weird,tense,dialogue
+Halo: The Master Chief Collection|guided
+Half-Life|guided,retro
+Half-Life 2|guided,retro
+Half-Life: Blue Shift|guided,retro
+Half-Life: Opposing Force|guided,retro
+Half-Life: Source|guided,retro
+DOOM|mastery
+Titanfall® 2|guided,mastery
+Wolfenstein: The New Order|guided
+Neon White|mastery,quicksession
+Resident Evil 4|tense,guided
+Resident Evil 7 Biohazard|tense,guided
+Resident Evil Village|tense,guided
+Outlast|tense
+Outlast 2|tense
+Amnesia: The Dark Descent|tense
+Little Nightmares|tense,quicksession
+INSIDE|tense,quicksession
+Oxenfree|dialogue,gentle
+Heaven's Vault|dialogue,gentle
+Middle-earth™: Shadow of Mordor™|guided
+Middle-earth™: Shadow of War™|grind
+METAL GEAR SOLID V: THE PHANTOM PAIN|mastery
+METAL GEAR SOLID V: GROUND ZEROES|quicksession
+Assassin’s Creed® IV Black Flag™|exploration,grind
+DREDGE|guided
+Dying Light|grind,tense
+Saints Row IV: Re-Elected|weird,gentle
+Far Cry 3|grind
+Titan Quest Anniversary Edition|grind
+S.T.A.L.K.E.R.: Shadow of Chernobyl|punishing,tense,setup
+S.T.A.L.K.E.R.: Clear Sky|punishing,tense,setup
+S.T.A.L.K.E.R.: Call of Pripyat|punishing,tense,setup
+Black Desert|mmo,grind
+The Elder Scrolls® Online|mmo,grind
+STAR WARS™: The Old Republic™|mmo,grind
+Warframe|grind
+Stardew Valley|guided
`;

export interface ReferenceEntry {
  title: string;
  tags: string[];
  players: "S" | "O" | "C" | "M" | "T" | "";
  scale: "S" | "M" | "L" | "E" | "";
  supplement: boolean;
}

export function parseReference(txt = REFERENCE_TXT): ReferenceEntry[] {
  const out: ReferenceEntry[] = [];
  for (const raw of txt.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const supplement = line.startsWith("+");
    const p = (supplement ? line.slice(1) : line).split("|");
    out.push({
      title: p[0].trim(),
      tags: (p[1] ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      players: ((p[2] ?? "").trim() as ReferenceEntry["players"]) || "",
      scale: ((p[3] ?? "").trim() as ReferenceEntry["scale"]) || "",
      supplement,
    });
  }
  return out;
}
