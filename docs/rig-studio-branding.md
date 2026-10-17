# Hedgehog artwork

The user supplied the full-body hedgehog illustration for the Rig Animation Studio icon and launch screen. The splash uses that illustration, compressed as WebP without changing its composition. The portrait is an ImageGen adaptation of the supplied character.

- `static/images/branding/hedgehog-icon.png`: 512 px transparent portrait for favicon/header.
- `static/images/branding/hedgehog-splash.webp`: full illustration for the responsive launch page.
- `resources/branding/launcher-foreground.png`: 432 px transparent Android foreground; character fits in the central 264 px.
- `resources/branding/launcher-legacy.png`: 192 px legacy icon on the launch background.

`scripts/apply-rig-studio-branding.mjs` runs after `cap sync android`. It updates the generated manifest, adaptive/legacy launcher resources, and native splash theme. Android 12+ shows the system splash icon first; the responsive HTML launch page then displays the full character and enters the editor automatically. The user can skip immediately. Broken artwork cannot block entry.

The existing v6.7 test package is retained. Rigging and animation code are unchanged by this branding change.

## Portrait generation

Built-in ImageGen, reference: the supplied `Ёж-бандит на туалете с битой-2.png`, transparent background enabled. Prompt:

> Use case: identity-preserve. Asset type: one square Android launcher icon foreground illustration on true transparent background, 1024x1024. Input image 1 is the exact character identity and art style reference. Create a close head-and-shoulders portrait of THIS SAME mischievous hedgehog: angular tan face, dark gold-tipped spines, red paisley bandana, red eyes, cheek scar, crooked grin with gold teeth and one diamond tooth, lit cigar, black/red jacket collar and gold chain. Preserve the reference face and drawing quality. A small portion of his spiked baseball bat may appear behind his left shoulder as in the reference. Center face slightly above middle, keep all important features together so they fit inside a circular launcher crop, leave about 15 percent clear alpha padding around the outer silhouette. Readable bold silhouette and large expressive face. No toilet, no legs, no hands, no lettering, no border, no square background, no extra objects. Preserve the same polished detailed hand-painted sticker illustration aesthetic; no redesign, no replacement mascot.

Asset scaling, transparent padding and file compression are mechanical build preparation; the full-body source was not redrawn.
