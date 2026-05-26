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

## BIS Annual Self-Classification Report

Under 15 CFR §740.17(b)(1), exporters who self-classify encryption items (rather than obtaining a Commodity Classification via CCATS) are required to submit an **annual self-classification report** to the Bureau of Industry and Security (BIS) and the ENC Encryption Request Coordinator. The report covers items exported or reexported during the prior calendar year (Jan 1 – Dec 31) and is due by **February 1** of the following year.

Cafelytic uses only standard cryptography (HTTPS / TLS via the OS networking stack) and self-classifies under §740.17(b)(1). That means the annual report applies. Two ways to handle it:

1. **File the annual report** (default). Submit a CSV per [Supplement No. 8 to Part 742 of the EAR](https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-742) listing each self-classified product, its ECCN (5D992.c for standard mass-market encryption), and the authorization paragraph (NLR or License Exception ENC). Email the spreadsheet to crypt-supp8@bis.doc.gov AND enc@nsa.gov by Feb 1.
2. **Obtain a CCATS classification** (one-time). Submit a Commodity Classification Request through [SNAP-R](https://snapr.bis.doc.gov/). Once BIS issues a CCATS for Cafelytic, the item is exempted from the annual self-classification report and only the CCATS reference is needed for future submissions. Takes ~30 days for typical applications.

For v1, file the annual report. Revisit CCATS if Cafelytic ever ships features that warrant the closer BIS scrutiny (e.g. user-controlled encryption keys, end-to-end messaging).

This is a self-contained summary; for anything beyond the standard TLS case, verify with counsel familiar with EAR Part 740 before relying on it.

## Google Play

Play does not collect an export-compliance answer at submission time. The EAR classification still applies legally; just no Play-side form to fill out. The BIS annual report obligation above is the same whether the app ships on iOS, Android, or both.
