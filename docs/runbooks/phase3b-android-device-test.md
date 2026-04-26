# Phase 3b Android Device Test Runbook

This is the manual Android device-test checklist for the Phase 3b mobile touch UX overhaul; run it on a Pixel-class device before merging PR 6 and attach the completed checklist to the PR description.

| # | Step | Pass / Fail | Notes |
|---|---|---|---|
| 1 | Cold-launch a fresh install and complete the deep-link sign-in round-trip per the 3a runbook. | — | — |
| 2 | Type a prompt, send it, and verify the card appears in both the RecentStack and the Canvas Stack. | — | — |
| 3 | Tap the mic, speak, confirm a partial transcript is visible, tap stop, and send. | — | — |
| 4 | Disable Web Speech via the WebView flag (or use a device known to lack it), repeat the voice capture, and verify the Whisper round-trip fills the final text. | — | — |
| 5 | Start dictation, leave it running for 65 seconds, and verify auto-stop, auto-send, and the countdown shown after 50 seconds. | — | — |
| 6 | Tap the camera button, capture a photo, confirm the thumbnail appears in CameraSheet, send, and verify the image card lands in the stack with its thumbnail. | — | — |
| 7 | Copy a URL in another app, return to 1scratch, verify the suggest chip appears, and tap to insert it. | — | — |
| 8 | Long-press a card, drag it up three positions, release, and verify the zIndex order persists across an app restart. | — | — |
| 9 | Swipe a card left and verify the delete action with a 5-second undo toast, then swipe right and verify the archive action. | — | — |
| 10 | Toggle to the spatial view, two-finger pinch to 2x, two-finger pan, single-finger pan on the background, and long-press a card to drag it. | — | — |
| 11 | Switch through three tabs, return to Library, and verify the Continue rail shows the top three canvases by lastTouchedAt. | — | — |
| 12 | Long-press a section in the Library SectionTree, rename it, and verify the rename persists. | — | — |
| 13 | Enable airplane mode, tap the magnifier, type a query, and verify FTS results are returned. | — | — |
| 14 | Open You and verify the current device is labeled, then sign out another device and verify it is revoked. | — | — |
| 15 | Sign out, verify MobileSignIn is shown, sign back in, and verify cards reload. | — | — |
| 16 | Enable airplane mode, write five cards, verify the SyncBanner offline state and the tab dot, re-enable network, and verify reconnecting transitions to synced within 10 seconds on a second device. | — | — |
| 17 | Write three cards offline, force-stop the app via the task switcher, reopen it, and verify the outbox replays. | — | — |
| 18 | Toggle the theme in You then Settings, and verify the status bar icons flip between light and dark. | — | — |
| 19 | Enable the system reduce-motion preference, and verify tab, lift, and banner animations reduce to opacity fades. | — | — |
| 20 | Set Android font-scale to 2x and verify every surface scrolls without clipping. | — | — |
| 21 | Run the script that enumerates getBoundingClientRect() of interactive elements and assert every target is at least 44x44 (mic at least 56x56). | — | — |
| 22 | Run pnpm dev, resize the desktop browser below 600pt, verify the mobile swap, confirm canvas state is preserved, and check there are no console errors. | — | — |

## Exit gates

The following Definition of Done bullets (spec §9.5) gate the PR 6 merge:

- All unit tests green.
- Playwright narrow-window spec green in CI.
- Manual Android runbook fully checked and attached to PR 6.
- iOS Simulator build compiles.
- `pnpm -w tsc -b` clean.
- `grep -r react-rnd packages apps` empty.
- Quick Capture round-trip on a real Android device covers text, voice (Web Speech), camera, and clipboard, each creating cards.
- Canvas Stack with 50+ cards scrolls smoothly, reorders via long-press, and supports swipe-actions with undo within 5 seconds.
- Spatial pinch-zoom and two-finger pan match desktop trackpad gestures.
- Library Continue rail surfaces the last three canvases; recent cards paginate.
- You device list pulls from the server; per-row sign-out revokes correctly.
- Offline for 60 seconds with 5 cards flushes and reconciles on a second device within 10 seconds.
- Keyboard never occludes the composer; voice dictation streams while the keyboard is dismissed.
- Narrow-window desktop at 600pt or below swaps without remount errors and preserves canvas state.
- A11y targets are at least 44x44 (mic at least 56x56), contrast meets AA, and dynamic-type at 200% works.

## Hardware

Run this checklist on a Pixel 7 with USB debugging enabled, running Android 14. Phase 3 is Android-first per PLAN.md; iOS device validation is deferred to Phase 3c and is out of scope for this runbook.
