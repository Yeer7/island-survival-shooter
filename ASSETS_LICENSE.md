# Assets and licences

Every third-party file shipped in `public/assets/` is listed here with its source, author and licence. All of them are **CC0 1.0 (public domain dedication)**: free for commercial use, no attribution required (credited anyway). Nothing was copied from any other game.

Conventions applied on load (`src/assets/assets.ts`): metres, +Y up, origin at the base (feet), centred on X/Z. Scale is fitted in code, so the files are shipped as downloaded except where noted.

The Ultimate Stylized Nature and Survival Pack files come from the pack the owner downloaded (its `License.txt`: CC0 1.0 Universal, Public Domain Dedication).

Run `npm run lint:assets` to check every `.glb`/`.gltf`/`.fbx` and texture (parses, triangle and size budgets, listed in this file).

## Models

| Shipped file | Original asset | Author | Source | Licence | Changes |
| --- | --- | --- | --- | --- | --- |
| `nature/pine_a.glb` | Pine | Quaternius | https://poly.pizza/m/79gmlLnweB | CC0 1.0 | Embedded textures resized to 512 px (`scripts/repack_glb.py`) |
| `nature/pine_b.glb` | Pine | Quaternius | https://poly.pizza/m/igSu0cPoBz | CC0 1.0 | Textures resized to 512 px |
| `nature/pine_c.glb` | Pine | Quaternius | https://poly.pizza/m/rfnxJv0Rqa | CC0 1.0 | Textures resized to 512 px |
| `nature/rock_large.glb` | Rock Large | Quaternius | https://poly.pizza/m/54jZKTAt5p | CC0 1.0 | None (material replaced in code) |
| `nature/rock_medium.glb` | Rock | Quaternius | https://poly.pizza/m/Z6M4GNkgWt | CC0 1.0 | None |
| `nature/rock_cliff.glb` | Rock Large | Quaternius | https://poly.pizza/m/li0YBlBEMz | CC0 1.0 | None |
| `nature/rock_tall.glb` | Rock | Quaternius | https://poly.pizza/m/R2UjZAX3By | CC0 1.0 | None |
| `nature/rock_round.glb` | Rock Medium | Quaternius | https://poly.pizza/m/s1OJ3bBzqc | CC0 1.0 | Texture resized to 512 px |
| `nature/rock_small.glb` | Rock | Quaternius | https://poly.pizza/m/RtLRqYjfMs | CC0 1.0 | None |
| `nature/pebble.glb` | Rock | Quaternius | https://poly.pizza/m/4MUaQTcDdc | CC0 1.0 | None |
| `ultimate/Bush.gltf` + `Bush.bin` | Bush | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | None |
| `ultimate/Grass_Small.gltf` + `Grass_Small.bin` | Grass_Small | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | None (normals set straight up in code) |
| `ultimate/Grass.png` | Grass texture | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | Resized 1024 → 512 px |
| `ultimate/Bush_Leaves.png` | Bush_Leaves texture | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | Resized 1024 → 512 px |
| `ultimate/PalmTree_1.fbx`, `PalmTree_2.fbx`, `PalmTree_3.fbx` | PalmTree_1–3 | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | None (materials rebuilt in code from the textures below) |
| `ultimate/PalmTree_Trunk.jpg` | PalmTree_Trunk texture | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | Resized 2048 → 512 px |
| `ultimate/PalmTree_Leaves.png` | PalmTree_Leaves texture | Quaternius — Ultimate Stylized Nature Pack (May 2022) | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | Resized 1024 → 512 px |
| `survivalpack/FirstAidKit.fbx` | FirstAidKit (Curativo drop) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None (flat colours converted to PBR in code) |
| `survivalpack/Bandages.fbx` | Bandages | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None |
| `survivalpack/Can_Closed.fbx` | Can_Closed (Comida drop) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None |
| `survivalpack/Backpack.fbx` | Backpack (reserved for the backpack in phase 3C) | Quaternius — Survival Pack (Sept 2020) | https://quaternius.com/packs/survival.html | CC0 1.0 | None |
| `nature/fern.glb` | Fern | Quaternius | https://poly.pizza/m/jqcanvH7D6 | CC0 1.0 | Textures resized to 256 px |
| `enemies/tribal_human.glb` | Animated Human (Idle/Walk/Run/Punch/Death) — night cannibals, village guards and the Tribal Chief (skin tint, mask, club, skirt and headdress added in code) | Quaternius | https://poly.pizza/m/c3Ibh9I3udk | CC0 1.0 | None |
| `enemies/cave_skeleton.glb` | Skeleton (Idle/Running/Attack/Death) — Cave Guardian, scaled to 3.6 m, tinted, glowing eyes added in code | Quaternius | https://poly.pizza/m/wODZYCgX5Z | CC0 1.0 | None |
| `enemies/alpha_wolf.glb` | Wolf (Idle/Walk/Gallop/Attack/Death) — Alpha Beast, scaled, darkened, red eyes added in code | Quaternius | https://poly.pizza/m/P1gU3Qkr9r | CC0 1.0 | None |
| `animals/deer.glb` | Deer (animated) | Quaternius | https://poly.pizza/m/T6Cs7tmMHJ | CC0 1.0 | None |
| `animals/stag.glb` | Stag (animated) | Quaternius | https://poly.pizza/m/tQdzbZ1Cmw | CC0 1.0 | None |
| `tools/bow.glb` | Wooden Bow | Quaternius | https://poly.pizza/m/QnpqjLSKFU | CC0 1.0 | None |
| `tools/arrow.glb` | Arrow | Quaternius | https://poly.pizza/m/Rt48KEPDGt | CC0 1.0 | None |
| `tools/spear.glb` | Spear | Quaternius | https://poly.pizza/m/3zA9NtYBEi | CC0 1.0 | None |
| `tools/torch.glb` | Wooden Torch | Quaternius | https://poly.pizza/m/pNsfJzhXiD | CC0 1.0 | None |
| `tools/fishing_rod.glb` | Fishing Rod | Quaternius | https://poly.pizza/m/0YAR0Lg58p | CC0 1.0 | None |
| `survival/tool-axe.glb` | tool-axe (Survival Kit 2.0) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | None |
| `survival/tool-axe-upgraded.glb` | tool-axe-upgraded (Survival Kit 2.0) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | None (emissive tint added in code) |
| `survival/campfire-pit.glb` | campfire-pit (Survival Kit 2.0) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | None |
| `survival/fish.glb` | fish (Survival Kit 2.0) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | None |
| `survival/Textures/colormap.png` | Survival Kit colour atlas | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | None |

Poly Pizza pages list each Quaternius model as "CC0 1.0 / Public Domain"; the Kenney packs ship a `License.txt` stating CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/).

## Made in code (no third-party source)

- **Meat (raw/cooked), rolled hide and the Tribal Totem drops**: built in code with procedural marbling, grill-mark, leather and spiral textures (`src/weapons/models.ts`).
- **Cannibal props** (carved mask texture, clubs, spear, skirt, chief headdress) are made in code and attached to the CC0 rig's bones (`src/world/cannibals.ts`).
- **Sea turtles, washed-up barrels/crates, shells**: built in code (`src/world/animals.ts`, `src/world/beach.ts`).
- **North cave (tunnel, stalactites, bridge), east altar, escape sailboat, crash-site dirt patch, coconut, relic, Alpha heart and tactical flashlight drops**: built in code.
- **Tribal village**: thatched huts, skull totems, fire and crates built in code (`src/world/village.ts`).
- **Tree stumps**: a cylinder with the procedural bark texture on the side and a procedural growth-ring texture on the cut top (`src/world/vegetation.ts`, `src/world/textures.ts`).
- **Rabbits**: multi-part procedural model (`src/world/animals.ts`). No CC0 *animal* rabbit was available: the Quaternius "Rabbit"/"Bunny" files are humanoid characters, and the animal rabbits on Poly Pizza are CC-BY 3.0, so they were not used.
- **Terrain, bark, needle, sand, grass, rock and plank detail textures**: painted procedurally on canvases at load (`src/world/textures.ts`).
- **Aircraft wreck, luggage, cabin, palisade, gate, log holder, arms and remaining props**: built from primitives in code.
- **Sky, water, smoke and fire**: shaders in code.
- **All sound**: synthesised at runtime with the Web Audio API (`src/audio/soundEngine.ts`).
