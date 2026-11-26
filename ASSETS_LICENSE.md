# Assets and licences

Every third-party file shipped in `public/assets/` is listed here with its source, author and licence. All of them are **CC0 1.0 (public domain dedication)**: free for commercial use, no attribution required (credited anyway). Nothing was copied from any other game.

Conventions applied on load (`src/assets/assets.ts`): metres, +Y up, origin at the base (feet), centred on X/Z. Scale is fitted in code, so the files are shipped as downloaded except where noted.

The Ultimate Stylized Nature and Survival Pack files come from the pack the owner downloaded (its `License.txt`: CC0 1.0 Universal, Public Domain Dedication).

Run `npm run lint:assets` to check every `.glb`/`.gltf`/`.fbx` and texture (parses, triangle and size budgets, listed in this file).

## Models

| Shipped file | Original asset | Author | Source | Licence | Changes |
| --- | --- | --- | --- | --- | --- |
| `nature/pine_a.glb` | Pine | Quaternius | https://poly.pizza/m/79gmlLnweB | CC0 1.0 | Embedded textures resized to 512 px (`scripts/repack_glb.py`) — no longer loaded: pines are built in code since 2026-11-26 |
| `nature/pine_b.glb` | Pine | Quaternius | https://poly.pizza/m/igSu0cPoBz | CC0 1.0 | Textures resized to 512 px — no longer loaded: pines are built in code since 2026-11-26 |
| `nature/pine_c.glb` | Pine | Quaternius | https://poly.pizza/m/rfnxJv0Rqa | CC0 1.0 | Textures resized to 512 px |
| `nature/rock_large.glb` | Rock Large | Quaternius | https://poly.pizza/m/54jZKTAt5p | CC0 1.0 | None (material replaced in code) |
| `nature/rock_medium.glb` | Rock | Quaternius | https://poly.pizza/m/Z6M4GNkgWt | CC0 1.0 | None |
| `nature/rock_cliff.glb` | Rock Large | Quaternius | https://poly.pizza/m/li0YBlBEMz | CC0 1.0 | None |
| `nature/rock_tall.glb` | Rock | Quaternius | https://poly.pizza/m/R2UjZAX3By | CC0 1.0 | None |
| `nature/rock_round.glb` | Rock Medium | Quaternius | https://poly.pizza/m/s1OJ3bBzqc | CC0 1.0 | Texture resized to 512 px |
| `nature/rock_small.glb` | Rock | Quaternius | https://poly.pizza/m/RtLRqYjfMs | CC0 1.0 | None |
| `nature/pebble.glb` | Rock | Quaternius | https://poly.pizza/m/4MUaQTcDdc | CC0 1.0 | None |
| `ultimate/Bush.gltf` + `Bush.bin` | Bush | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | None — no longer loaded: shrubs are built in code since 2026-11-26 |
| `ultimate/Grass_Small.gltf` + `Grass_Small.bin` | Grass_Small | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | None (normals set straight up in code) |
| `ultimate/Grass.png` | Grass texture | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | Resized 1024 → 512 px |
| `ultimate/Bush_Leaves.png` | Bush_Leaves texture | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | Resized 1024 → 512 px |
| `ultimate/PalmTree_1.fbx`, `PalmTree_2.fbx`, `PalmTree_3.fbx` | PalmTree_1–3 | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | None (materials rebuilt in code from the textures below) — no longer loaded: palms are built in code since 2026-11-26 |
| `ultimate/PalmTree_Trunk.jpg` | PalmTree_Trunk texture | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | Resized 2048 → 512 px |
| `ultimate/PalmTree_Leaves.png` | PalmTree_Leaves texture | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | Resized 1024 → 512 px |
| `survivalpack/FirstAidKit.fbx` | FirstAidKit (Curativo drop) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/Bandages.fbx` | Bandages (Pano drop) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None |
| `survivalpack/Can_Red.fbx` | Can_Red (Comida drop, red label) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None |
| `survivalpack/Backpack.fbx` | Backpack (reserved for the backpack in phase 3C) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None |
| `survivalpack/Tent.fbx` | Tent (village hide tents) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (recoloured in code as tanned hide on wooden poles) |
| `survivalpack/Pot.fbx` | Pot (village cooking pots) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/WoodenTorch.fbx` | WoodenTorch (village torches; flames are particles in code) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (recoloured in code) |
| `survivalpack/WoodLog.fbx` | WoodLog (log benches round the village fire) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (recoloured in code) |
| `survivalpack/Radio.fbx` | Radio (expedition camp table in the cave) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/GasCan.fbx` | GasCan (expedition camp in the cave) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/Shovel.fbx` | Shovel (explorer remains in the cave) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/WaterBottle_1.fbx` | WaterBottle_1 (explorer remains) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/Battery_Big.fbx` | Battery_Big (explorer remains) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/PropaneTank.fbx` | PropaneTank (explorer remains) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/Can_Open.fbx` | Can_Open (explorer remains) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/Pan.fbx` | Pan (explorer remains) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `cave/crystal_cluster.glb` | Crystal (glowing crystals, recoloured emissive in code) | iPoly3D | https://poly.pizza/m/WzWPKHFMkL | CC0 1.0 | Repacked with `scripts/repack_glb.py` |
| `cave/crystal_spire.glb` | Crystal (glowing crystals) | iPoly3D | https://poly.pizza/m/3saqXqoOti | CC0 1.0 | Repacked with `scripts/repack_glb.py` |
| `cave/mineral.glb` | Mineral (glowing crystals) | Quaternius | https://poly.pizza/m/STixpWYaTd | CC0 1.0 | Repacked with `scripts/repack_glb.py` |
| `cave/mushroom.glb` | Mushroom (cave mushrooms, faint glow added in code) | Quaternius | https://poly.pizza/m/db1tjMhmiA | CC0 1.0 | Repacked with `scripts/repack_glb.py` |
| `cave/mushroom_cluster.glb` | Mushroom (cluster) | Quaternius | https://poly.pizza/m/aOW08oSrd4 | CC0 1.0 | Embedded texture resized to 256 px (`scripts/repack_glb.py`) |
| `textures/rock_face_diff_512.jpg` | Rock Face — albedo (cave walls, floor and every rock inside the cave) | Poly Haven (photography Charlotte Baglioni, processing Dario Barresi) | https://polyhaven.com/a/rock_face | CC0 1.0 | 1k JPG resized to 512 px and desaturated 65% toward grey |
| `textures/rock_face_nor_gl_512.jpg` | Rock Face — normal map (OpenGL) | Poly Haven | https://polyhaven.com/a/rock_face | CC0 1.0 | 1k JPG resized to 512 px |
| `textures/rock_face_rough_512.jpg` | Rock Face — roughness | Poly Haven | https://polyhaven.com/a/rock_face | CC0 1.0 | 1k JPG resized to 512 px (greyscale) |
| `textures/pine_bark_diff_512.jpg` | Pine Bark — albedo (pine trunks, branches, stumps and logs) | Poly Haven (Dimitrios Savva) | https://polyhaven.com/a/pine_bark | CC0 1.0 | 1k JPG resized to 512 px |
| `textures/pine_bark_nor_gl_512.jpg` | Pine Bark — normal map (OpenGL) | Poly Haven (Dimitrios Savva) | https://polyhaven.com/a/pine_bark | CC0 1.0 | 1k JPG resized to 512 px |
| `textures/pine_bark_rough_512.jpg` | Pine Bark — roughness | Poly Haven (Dimitrios Savva) | https://polyhaven.com/a/pine_bark | CC0 1.0 | 1k JPG resized to 512 px (greyscale) |
| `village/skull.glb` | Skull (effigies, door posts, gates, skull pile) | Quaternius | https://poly.pizza/m/YgmRBtFlcF | CC0 1.0 | None (tinted bone-white in code) |
| `village/bone.glb` | Bone (effigies, hanging bones, scattered bones) | Quaternius | https://poly.pizza/m/uMs0lDp1u3 | CC0 1.0 | None (tinted bone-white in code) |
| `village/crate.glb` | Crate (lootable village crates) | Quaternius | https://poly.pizza/m/3VGWnZPXmG | CC0 1.0 | None |
| `village/barrel.glb` | Barrel (village barrels) | Quaternius | https://poly.pizza/m/ONdghDBByN | CC0 1.0 | None |
| `village/cauldron.glb` | Cauldron (the cannibals' pot over the fire) | Quaternius | https://poly.pizza/m/QaWJOPa6Gt | CC0 1.0 | None (stew recoloured in code) |
| `nature/fern.glb` | Fern | Quaternius | https://poly.pizza/m/jqcanvH7D6 | CC0 1.0 | Textures resized to 256 px |
| `enemies/tribal_human.glb` | Animated Human (Idle/Walk/Run/Punch/Death) — night cannibals, village guards and the Tribal Chief (skin tint, mask, club, skirt and headdress added in code) | Quaternius | https://poly.pizza/m/c3Ibh9I3udk | CC0 1.0 | None |
| `enemies/cave_skeleton.glb` | Skeleton (Idle/Running/Attack/Death) — Cave Guardian, scaled to 3.6 m, tinted, glowing eyes added in code | Quaternius | https://poly.pizza/m/wODZYCgX5Z | CC0 1.0 | None |
| `enemies/alpha_wolf.glb` | Wolf (Idle/Walk/Gallop/Attack/Death) — Alpha Beast, scaled, darkened, red eyes added in code | Quaternius | https://poly.pizza/m/P1gU3Qkr9r | CC0 1.0 | None |
| `enemies/cave_spider.glb` | Spider (Idle/Walk/Attack/Death) — giant cave spiders in the first chamber, darkened and with glowing eyes in code | Quaternius | https://poly.pizza/m/yRYJiAJyiM | CC0 1.0 | Embedded textures capped at 512 px (`scripts/repack_glb.py`) |
| `enemies/deep_lord.glb` | Giant (Idle/Walk/Run/Attack/Death) — the Lord of the Depths: stone-grey skin, purple crystal pauldrons and a crystal-studded stone maul added in code | Quaternius | https://poly.pizza/m/BldaiPtyJa | CC0 1.0 | Embedded textures capped at 512 px (`scripts/repack_glb.py`) |
| `animals/deer.glb` | Deer (animated) | Quaternius | https://poly.pizza/m/T6Cs7tmMHJ | CC0 1.0 | None |
| `animals/stag.glb` | Stag (animated) | Quaternius | https://poly.pizza/m/tQdzbZ1Cmw | CC0 1.0 | None |
| `tools/bow.glb` | Wooden Bow | Quaternius | https://poly.pizza/m/QnpqjLSKFU | CC0 1.0 | None |
| `tools/arrow.glb` | Arrow | Quaternius | https://poly.pizza/m/Rt48KEPDGt | CC0 1.0 | None |
| `tools/spear.glb` | Spear | Quaternius | https://poly.pizza/m/3zA9NtYBEi | CC0 1.0 | None |
| `tools/torch.glb` | Wooden Torch | Quaternius | https://poly.pizza/m/pNsfJzhXiD | CC0 1.0 | None |
| `tools/fishing_rod.glb` | Fishing Rod | Quaternius | https://poly.pizza/m/0YAR0Lg58p | CC0 1.0 | None |
| `survival/campfire-pit.glb` | campfire-pit (Survival Kit 2.0) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | None |
| `survival/fish.glb` | fish (Survival Kit 2.0) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | None |
| `survival/Textures/colormap.png` | Survival Kit colour atlas | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | None |

Poly Pizza pages list each Quaternius model as "CC0 1.0 / Public Domain"; the Kenney packs ship a `License.txt` stating CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/).

## Audio

The recordings were picked by ear by the project owner from Freesound, all CC0 1.0 (each page's licence field reads "Creative Commons 0"; the Fission9 pack's `_readme_and_license.txt` lists every footstep file as "Creative Commons 0"). Flesh hits, thuds, breaking wood and light knocks are Kenney "Impact Sounds" (CC0 1.0, the pack's `License.txt`). The raw `.wav` files stay out of the repository (`Soms/` is git-ignored); `scripts/master_audio.py` trims silence, cuts single footsteps, folds the ambience into click-free 14 s loops and normalises levels without re-pitching anything. The decoded peak, loudness and length of every shipped file are in `public/assets/audio/manifest.json`, which `npm run lint:assets` checks against the files on disk.

| File | Use | Author (source file) | URL | Licence | Changes |
| --- | --- | --- | --- | --- | --- |
| `audio/sea.mp3` | ambience | Alex_hears_things (`352356__alex_hears_things__gentle-small-waves-lapping-on-shore.wav`) | https://freesound.org/s/352356/ | CC0 1.0 | Mono MP3; 14 s loop from 82.0 s, folded 1.5 s crossfade; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/forest_day.mp3` | ambience | Nox_Sound (`530908__nox_sound__ambiance_wind_forest_trees_loop_01.wav`) | https://freesound.org/s/530908/ | CC0 1.0 | Mono MP3; 14 s loop from 2.0 s, folded 1.5 s crossfade; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/forest_night.mp3` | ambience | timothyd4y (`587907__timothyd4y__forest-at-night-ambience.wav`) | https://freesound.org/s/587907/ | CC0 1.0 | Mono MP3; 14 s loop from 58.0 s, folded 1.5 s crossfade; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/campfire.mp3` | ambience | marb7e (`620324__marb7e__campfire-crackling-loop.wav`) | https://freesound.org/s/620324/ | CC0 1.0 | Mono MP3; 14 s loop from 0.0 s, folded 1.5 s crossfade; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/cave.mp3` | ambience | Nox_Sound (`553080__nox_sound__ambiance_atmosphere_cave_loop_stereo.ogg`) | https://freesound.org/s/553080/ | CC0 1.0 | Mono MP3; 14 s loop from 1.0 s, folded 1.5 s crossfade; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/chop_0.mp3` | chop | micahlg (`421928__micahlg__chopping-wood-01.wav`) | https://freesound.org/s/421928/ | CC0 1.0 | Mono MP3; trimmed to the transient; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/whoosh_0.mp3` | whoosh | Sadiquecat (`855844__sadiquecat__whoosh-long-bamboo-stick-os-st-13.wav`) | https://freesound.org/s/855844/ | CC0 1.0 | Mono MP3; trimmed; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/creak_0.mp3`, `audio/crash_0.mp3` | crash, creak | ozymandias37 (`867699 (cracking part); 867699 (impact part)`) | https://freesound.org/s/867699/ | CC0 1.0 | Mono MP3; cracking before the fall, up to 2.44 s; main impact from 3.07 s with its tail; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/step_grass_0.mp3`, `audio/step_grass_1.mp3`, `audio/step_grass_2.mp3`, `audio/step_grass_3.mp3`, `audio/step_grass_4.mp3` | step | Fission9 (`521587__fission9__hiking-boot-footsteps-on-grass.wav`) | https://freesound.org/s/521587/ | CC0 1.0 | Mono MP3; single step; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/step_wood_0.mp3`, `audio/step_wood_1.mp3`, `audio/step_wood_2.mp3`, `audio/step_wood_3.mp3`, `audio/step_wood_4.mp3` | step | Fission9 (`521589__fission9__hiking-boot-footsteps-on-wooden-planks.wav`) | https://freesound.org/s/521589/ | CC0 1.0 | Mono MP3; single step; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/step_stone_0.mp3`, `audio/step_stone_1.mp3`, `audio/step_stone_2.mp3`, `audio/step_stone_3.mp3`, `audio/step_stone_4.mp3` | step | Fission9 (`521590__fission9__hiking-boot-footsteps-on-stone.wav`) | https://freesound.org/s/521590/ | CC0 1.0 | Mono MP3; single step; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/step_sand_0.mp3`, `audio/step_sand_1.mp3`, `audio/step_sand_2.mp3`, `audio/step_sand_3.mp3`, `audio/step_sand_4.mp3` | step | Fission9 (`521588__fission9__hiking-boot-footsteps-on-gravel.wav`) | https://freesound.org/s/521588/ | CC0 1.0 | Mono MP3; low-passed 3.2 kHz (gravel -> sand); single step; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |
| `audio/hit_0.mp3`, `audio/hit_1.mp3`, `audio/hit_2.mp3`, `audio/hit_3.mp3`, `audio/thud_0.mp3`, `audio/thud_1.mp3`, `audio/thud_2.mp3`, `audio/break_0.mp3`, `audio/break_1.mp3`, `audio/break_2.mp3`, `audio/knock_0.mp3`, `audio/knock_1.mp3`, `audio/knock_2.mp3` | break, hit, knock, thud | Kenney — Impact Sounds (`impactPlank_medium_000.ogg (Kenney Impact Sounds); impactPlank_medium_001.ogg (Kenney Impact Sounds); impactPlank_medium_002.ogg (Kenney Impact Sounds); impactPunch_heavy_000.ogg (Kenney Impact Sounds); impactPunch_heavy_001.ogg (Kenney Impact Sounds); impactPunch_heavy_002.ogg (Kenney Impact Sounds); impactPunch_heavy_003.ogg (Kenney Impact Sounds); impactSoft_heavy_000.ogg (Kenney Impact Sounds); impactSoft_heavy_001.ogg (Kenney Impact Sounds); impactSoft_heavy_002.ogg (Kenney Impact Sounds); impactWood_light_000.ogg (Kenney Impact Sounds); impactWood_light_001.ogg (Kenney Impact Sounds); impactWood_light_002.ogg (Kenney Impact Sounds)`) | https://kenney.nl/assets/impact-sounds | CC0 1.0 | Mono MP3; trimmed to the transient; normalised per family under a -1.5 dBFS peak (`scripts/master_audio.py`) |

## Made in code (no third-party source)

- **Meat (raw/cooked), rolled hide and the Tribal Totem drops**: built in code with procedural marbling, grill-mark, leather and spiral textures (`src/weapons/models.ts`).
- **Cannibal props** (carved mask texture, clubs, spear, skirt, chief headdress) are made in code and attached to the CC0 rig's bones (`src/world/cannibals.ts`).
- **Sea turtles, washed-up barrels/crates, shells**: built in code (`src/world/animals.ts`, `src/world/beach.ts`).
- **North cave (tunnel, stalactites, bridge), east altar, escape sailboat, crash-site dirt patch, coconut, relic, Alpha heart and tactical flashlight drops**: built in code.
- **Cannibal village structures** (chief's round hut and the smaller hut with stake walls, wattle panels and tiered thatch roofs, the A-frame lodge, drying racks, skull gates and sharpened palisades) and the packed-earth ground, thatch, wattle, hide and straw-fringe textures: built in code (`src/world/village.ts`), dressed with the CC0 models above.
- **Breakable effigies** (crossed stakes, rope lashings, cloth strips texture) are built in code (`src/world/effigies.ts`) around the CC0 skull and bone models.
- **Cave interior** (organic FBM tunnel, chasm cliffs, suspension bridge, textured stalactites and stalagmites, expedition table and locked chest): built in code (`src/world/cave.ts`).
- **Log cabin and survival bed** (linen and leather textures): built in code (`src/world/base.ts`).
- **Tribal village**: thatched huts, skull totems, fire and crates built in code (`src/world/village.ts`).
- **Tree stumps**: a cylinder with the procedural bark texture on the side and a procedural growth-ring texture on the cut top (`src/world/vegetation.ts`, `src/world/textures.ts`).
- **Rabbits**: multi-part procedural model (`src/world/animals.ts`). No CC0 *animal* rabbit was available: the Quaternius "Rabbit"/"Bunny" files are humanoid characters, and the animal rabbits on Poly Pizza are CC-BY 3.0, so they were not used.
- **Terrain, bark, needle, sand, grass, rock and plank detail textures**: painted procedurally on canvases at load (`src/world/textures.ts`).
- **Aircraft wreck, luggage, cabin, palisade, gate, log holder, arms and remaining props**: built from primitives in code.
- **Sky, water, smoke and fire**: shaders in code.
- **Remaining sound** (ambience, fire, music stings, interface, bow, voices of the creatures) and the fallback for every sample family: synthesised at runtime with the Web Audio API (`src/audio/soundEngine.ts`).
