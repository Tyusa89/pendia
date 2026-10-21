# Diarization spike: two-voice script (synthetic)

Two people read this aloud, one as **Dr. Patel (D)** and one as **Rosa (P)**, in one WAV
(mono, 16 kHz, under 2 minutes, so it fits the file endpoint's 10 min / 32 MB cap).
Natural pace, small pauses between turns. Include 2 deliberate overlaps/interruptions (marked `~`).
Ground truth is the speaker letter here; the API's A/B labels are anonymous and will be matched by best fit.

Traps for the "who is the doctor" heuristic: the patient states a dose and gives an instruction-sounding sentence.

| # | Who | Line |
|---|-----|------|
| 1 | D | Good morning, Rosa. How have you been feeling since the last visit? |
| 2 | P | Pretty good. I take the Lisinopril, ten milligrams, every morning with my coffee. |
| 3 | D | Your blood pressure is still a little high today. I want to increase the Lisinopril from ten milligrams to twenty milligrams, starting tomorrow. |
| 4 | P | Twenty? Okay. Should I take it with food? |
| 5 | D | Same as before, once a day in the morning. |
| 6 | D | I'm also booking a blood test within the next two weeks. Someone will need to drive you there. |
| 7 | P | My son Carlos can probably drive me. ~Tell him to call the lab first. |
| 8 | D | ~Yes, the front desk will give you the lab's number. |
| 9 | D | One more thing. If your ankles start to swell, call the office right away. |
| 10 | P | Call the office if my ankles swell. I will. |
| 11 | D | Good. We'll see you after the blood test. |
| 12 | P | Thank you, doctor. |

Expected extraction (for Phase 3 later): med change Lisinopril 10 mg → 20 mg starting tomorrow (turn 3);
task: drive Rosa to blood test within 2 weeks (turn 6); watch item: call the office if ankles swell (turn 9).
Patient turns 2, 4, 7, 10, 12 must produce **zero** extracted items.

## What the spike must report
(a) Does `POST /v1/asr/transcribe` return speaker labels at all? (b) Turn-assignment accuracy vs the table
(per-turn, and by seconds). (c) Is any patient turn (esp. 2, 7, 10) labeled as the doctor's speaker?
Run the same clip through the file path and the realtime WebSocket (diarization session mode).
