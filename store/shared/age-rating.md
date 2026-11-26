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
| Unrestricted Web Access | Are there URLs that open in a browser? | No (the in-app privacy link opens in an embedded system browser via @capacitor/browser, which Apple does not count as unrestricted web access for this question. The Beginners Guide, `start.html`, also has two YouTube links; they are `target="_blank"` links that leave the app for the system browser) |
| User Generated Content | Does the app contain user-generated content? | Yes (users can publish recipes, each with a name, an optional description and a creator display name; moderation note below) |
| Messaging and Chat | Does the app include messaging or chat? | No |
| Social Media | Does the app include social media features? | No. Apple defines this as redistributing or amplifying user content "through a social feed or similar discovery method" (views, likes, comments, shares). The library has none of that: recipes sit in fixed category trays, newest first, the featured picks are hard-coded slugs, and nothing shows engagement. Broad visibility of published recipes is what User Generated Content above declares. A Yes would also raise the rating above 4+. First asked at the 1.2 submission |
| Advertising | Does the app contain advertising? | No |
| Parental Controls | Does the app offer parental controls? | No |
| Age Assurance | Does the app verify a person's age? | No |

Apple adds questions to this questionnaire from time to time, and an unanswered one blocks the next submission: App Store Connect rejects it with `ENTITY_ERROR.ATTRIBUTE.REQUIRED` on `ageRatingDeclarations`, naming the missing attribute. Answer it under **App Information → Age Rating** and record it in the table above.

Resulting Apple rating: **4+**

User-generated content note for the reviewer:

> Signed-in users can publish recipes to a public library that all users can browse. A published recipe shows a name (up to 40 characters), an optional description (up to 200 characters), the creator's display name (up to 40 characters) and the mineral target values. There is no chat, direct messaging or comments. We moderate reactively: anyone can report a recipe through the in-app Support page contact form, and we remove inappropriate recipes by hand.

### What a published recipe carries

Checked against the code on 2026-11-23 (app 1.2.2). The reviewer note above and the Play note below were reworded to match on 2026-11-25; submissions through 1.2.2 went in with the older wording, which mentioned only the name.

- **Name**: up to 40 characters.
- **Description**: optional, up to 200 characters. The owner sets it from the edit dialog on their library card.
- **Creator display name**: up to 40 characters, asked for the first time a user publishes and shown on the card.
- **Flavor tags, brew method and roast**: picked from fixed lists, no free text.
- **The mineral target values.**

The three length limits are `maxlength` on the inputs only. The database has no length check on those columns, so a request sent straight to the API could store longer text.

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
| User-generated content | Yes (published recipes: name, optional description, creator display name) |
| Shares user location | No |
| Allows users to interact | **Yes** (no chat, no comments, no DMs, but users can publish recipes to the library that other users can view; per Google's IARC guidance, sharing user-created content with others counts as "users interact" even without messaging features — see [support.google.com/googleplay/android-developer/answer/7021383](https://support.google.com/googleplay/android-developer/answer/7021383)) |
| Digital purchases | No |
| Unrestricted internet access | No |

Resulting Play rating: **Everyone**, with an "Interactive Elements" disclosure of **Users Interact** (because users can share recipes publicly). IARC equivalent across regions: PEGI 3, USK 0, ClassInd L. The interactivity disclosure is a labelled note alongside the rating, not a separate rating bucket.

Interactivity note for the Play Console reviewer (paste into the relevant "Tell us about interaction features" prompt):

> Signed-in users can publish recipes to a public library that all users can browse. A published recipe shows a name (up to 40 characters), an optional description (up to 200 characters), the creator's display name (up to 40 characters) and the mineral target values. There is no chat, direct messaging or comments. We moderate reactively: anyone can report a recipe through the in-app Support page contact form, and we remove inappropriate recipes by hand.

## Open moderation gap

Both stores' user-generated-content rules ask for more than the app has today:

- **Apple** (App Review Guideline 1.2): a way to report offensive content with timely responses, and the ability to block abusive users, alongside filtering and published contact info.
- **Google Play** (User Generated Content policy): apps with publicly accessible UGC "must implement in-app functionality to report users and content, and to block users", plus clear terms of use.

Today there is no pre-publication filter, no per-recipe report action, and no user blocking: the only channel is the Support page contact form and email, and published text is removed by hand. Apple approved 1.0 and 1.1 with the older reviewer note (name only); 1.2, 1.2.1 and 1.2.2 have shipped since.

**Decision (2026-11-06): deferred until a store review flags it.** Build in-app reporting (and user blocking, which Play requires) only if an Apple or Google review cites Guideline 1.2 or the UGC policy. No deadline is set for either platform until then.
