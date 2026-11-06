# Age rating questionnaire answers

Cafelytic targets 4+ on the App Store and Everyone on Google Play. Both stores ask a multi-section questionnaire; record the answers here so they stay consistent across resubmissions.

## App Store Connect age rating

Apple's questionnaire lives under **App Information → Age Rating**. All answers below are None / No unless noted.

| Section | Question | Answer |
|---|---|---|
| Cartoon or Fantasy Violence | Frequency / intensity | None |
| Realistic Violence | Frequency / intensity | None |
| Prolonged Graphic or Sadistic Realistic Violence | Frequency / intensity | None |
| Guns or Other Weapons | Frequency / intensity | None |
| Sexual Content or Nudity | Frequency / intensity | None |
| Graphic Sexual Content and Nudity | Frequency / intensity | None |
| Profanity or Crude Humor | Frequency / intensity | None |
| Alcohol, Tobacco, or Drug Use or References | Frequency / intensity | None |
| Mature/Suggestive Themes | Frequency / intensity | None |
| Horror/Fear Themes | Frequency / intensity | None |
| Medical/Treatment Information | Frequency / intensity | None |
| Health or Wellness Topics | Does the app contain health or wellness topics? | No |
| Simulated Gambling | Frequency / intensity | None |
| Gambling | Real-money gambling? | No |
| Contests | Sweepstakes / contests? | None |
| Loot Boxes | Does the app contain loot boxes? | No |
| Unrestricted Web Access | Are there URLs that open in a browser? | No (the in-app privacy link opens in an embedded system browser via @capacitor/browser, which Apple does not count as unrestricted web access for this question) |
| User Generated Content | Does the app contain user-generated content? | Yes (users can publish recipe names; moderation note below) |
| Messaging and Chat | Does the app include messaging or chat? | No |
| Social Media | Does the app include social media features? | No (no profiles, follows, feeds, likes, or comments; publishing a recipe to the public library is covered by User Generated Content above). First asked at the 1.2 submission |
| Advertising | Does the app contain advertising? | No |
| Parental Controls | Does the app offer parental controls? | No |
| Age Assurance | Does the app verify a person's age? | No |

Apple adds questions to this questionnaire from time to time, and an unanswered one blocks the next submission: App Store Connect rejects it with `ENTITY_ERROR.ATTRIBUTE.REQUIRED` on `ageRatingDeclarations`, naming the missing attribute. Answer it under **App Information → Age Rating** and record it in the table above.

Resulting Apple rating: **4+**

User-generated content note for the reviewer:

> Recipes shared to the public library have a name field that any signed-in user can fill. Names are short (<200 chars) and shown to other users on the library page. We moderate reactively: the app exposes no reporting flow yet because v1 has a small invite-only audience, but inappropriate names can be removed by a database-side query. A public reporting UI is planned for a future release.

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

> Signed-in users can publish recipes they save to a public library that all users can browse. There is no chat, direct messaging, comments, or any other channel for direct user-to-user communication. The shared field is the recipe name (under 200 chars) plus the mineral target values. Reactive moderation: inappropriate names can be removed via a database-side query; a public reporting UI is planned for a future release.
