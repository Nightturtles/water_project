# Export compliance

The US export regulations require every iOS app to declare its use of encryption. Apple asks this on every TestFlight and App Store submission via App Store Connect. Cafelytic's answer is the same across all builds.

## App Store Connect answers

| Question | Answer |
|---|---|
| Does your app use encryption? | Yes |
| Does your app qualify for any of the exemptions provided in Category 5, Part 2 of the U.S. Export Administration Regulations? | Yes |
| Does your app meet any of the following: (a) Uses encryption only for authentication. (b) Uses standard encryption algorithms... (c) Uses encryption ONLY in support of authentication. (d) etc. | **(b) Yes** — Cafelytic uses only standard cryptography (HTTPS / TLS via the system networking stack) and qualifies for the exemption in 15 CFR §740.17(b). |
| Is your app available on the French App Store? | Yes (we ship globally) |

After the first build, Apple lets you check "Use the same answers for all future builds" — do that.

## App Store Connect Annual Self Classification Report

Apps that use encryption but qualify for the §740.17(b) exemption do **not** need to file an annual self-classification report with the Bureau of Industry and Security (BIS), because Cafelytic uses only standard cryptography from the operating system. No filing required.

## Google Play

Play does not collect an export-compliance answer at submission time. The classification still applies legally; just no form to fill out.
