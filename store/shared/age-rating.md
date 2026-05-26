# Age rating questionnaire answers

Cafelytic targets 4+ on the App Store and Everyone on Google Play. Both stores ask a multi-section questionnaire; record the answers here so they stay consistent across resubmissions.

## App Store Connect age rating

Apple's questionnaire lives under **App Information → Age Rating**. All answers below are None / No unless noted.

| Section | Question | Answer |
|---|---|---|
| Cartoon or Fantasy Violence | Frequency / intensity | None |
| Realistic Violence | Frequency / intensity | None |
| Sexual Content or Nudity | Frequency / intensity | None |
| Profanity or Crude Humor | Frequency / intensity | None |
| Alcohol, Tobacco, or Drug Use or References | Frequency / intensity | None |
| Mature/Suggestive Themes | Frequency / intensity | None |
| Horror/Fear Themes | Frequency / intensity | None |
| Medical/Treatment Information | Frequency / intensity | None |
| Gambling and Contests | Frequency / intensity | None |
| Unrestricted Web Access | Are there URLs that open in a browser? | No (the in-app privacy link opens in an embedded system browser via @capacitor/browser, which Apple does not count as unrestricted web access for this question) |
| Gambling | Real-money gambling? | No |
| Contests | Sweepstakes / contests? | No |
| User Generated Content | Does the app contain user-generated content? | Yes (users can publish recipe names; moderation note below) |

Resulting Apple rating: **4+**

User-generated content note for the reviewer:

> Recipes shared to the public library have a name field that any signed-in user can fill. Names are short (<200 chars) and shown to other users on the library page. We moderate reactively: the app exposes no reporting flow yet because v1 has a small invite-only audience, but inappropriate names can be removed by a database-side query. A public reporting UI is planned for v1.1.

## Google Play age rating

Play uses the IARC questionnaire. Answers mirror the Apple ones.

| Category | Answer |
|---|---|
| Violence | None |
| Sexuality | None |
| Language | None |
| Controlled substance | None |
| Gambling | None |
| Crude humor | None |
| Discrimination | None |
| Horror/fear | None |
| User-generated content | Yes (recipe names) |
| Shares user location | No |
| Allows users to interact | **Yes** (no chat, no comments, no DMs, but users can publish recipes to the library that other users can view; per Google's IARC guidance, sharing user-created content with others counts as "users interact" even without messaging features — see [support.google.com/googleplay/android-developer/answer/7021383](https://support.google.com/googleplay/android-developer/answer/7021383)) |
| Digital purchases | No |
| Unrestricted internet access | No |

Resulting Play rating: **Everyone**, with an "Interactive Elements" disclosure of **Users Interact** (because users can share recipes publicly). IARC equivalent across regions: PEGI 3, USK 0, ClassInd L. The interactivity disclosure is a labelled note alongside the rating, not a separate rating bucket.

Interactivity note for the Play Console reviewer (paste into the relevant "Tell us about interaction features" prompt):

> Signed-in users can publish recipes they save to a public library that all users can browse. There is no chat, direct messaging, comments, or any other channel for direct user-to-user communication. The shared field is the recipe name (under 200 chars) plus the mineral target values. Reactive moderation: inappropriate names can be removed via a database-side query; a public reporting UI is planned for v1.1.
