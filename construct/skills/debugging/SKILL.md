Hello, Reginald. Hi, Reginald. Yes. You know, Mr Kitties. Damn. Back. Hello, Shinto. Intel So. Yeah, I'll take it right. Yes, Mr Shinzo, we know, we are aware. No. Help. OK. Yeah. Oh jeez, right. Listen is. You get a chill. You get a chill. England's there. And. Ah, gosh. Out. Nice, nice, nice. Like. Oh. OK. Yes. Umm. Ah. Ah. Yes. Good Kitty. Hey Kitty one. Yeah, one. Hmm. Hmm. But. Yeah. Hmm. Reg. Chill buddy, please, Reg. On. Routing to there. Here. Oh. Oh. Paper. Ah. Oh. No. Ah. Ring. Read. Oh. I'm Weber. Oh yeah, yeah. I'm just trying to go there. OK. Lift chip. OK. Yes. Hello, how are you? Yeah. You doing doing good or better after after surgery? Doing good or or better after surgery and everything. Really. Yeah. Yeah, interesting. Too good? Yeah, pretty good. I think he was going on just usual stuff. Maybe, maybe going out with the family and then some like social stuff, but it's just about it, I think. Working on it. We've been, we've only been pretty active about just doing like like little tricks. Like, we went back to Yosemite a couple times. We've done a couple camping things. It's been nice. Yeah, not, not like thoroughly currently. Like I said, we just, we did a couple like you know one or two day ones, 123 day ones over the past like couple months. Yeah, it certainly looks like it. Yeah. Oh yeah, this we we very much do, yeah. Yeah. That's good. That's very good. Yeah. I think in the mail for you, it'll probably take a couple days, but yeah, yeah. Oh yeah. It'll be, it'll be fine. It'll be fine, yeah. How are the how are the the cats doing? The cow the cats doing. Yeah, 0. Yeah, yeah. Yeah. Oh yeah, I bet. Yeah, we should choose him. That's a great shape, yeah. I bet you know, yeah. That's good. Yeah, yeah. Yeah. Good. Actually, speaking of jumping, I just took a video of Shinzo. I'll, I'll. I'll send you. He likes to. He likes to do like acrobatics, basically with like, teaser choices. Yeah, I'll send you videos. He has a particular way of like also sitting with his paws cross, which is like and it looks more serious or something and it's interesting. It's only kind of really noticed to do that regularly, but. Yeah, but they they're doing good. They're doing good. That's good. Yeah. Yeah. I texted him and said thanks. Yes. That's good, yeah. Really. Yeah. It's getting kind of warm here, but not not like that warm. Don't want to find it. Time to come back in like the next, I don't know. Month or so ideally. Yeah. Yeah, it's kind of hard to avoid sometimes, but yeah. Yeah, yeah, it's been, it's not been a great time for it. Yeah, II don't know. I relaxed that somewhat, but yeah II don't know II still try to keep myself safe and not too wrapped up in news if you can't really do anything about it manifestly. Oh yeah. I mean, we we cook a lot more than certainly than I used to. Have found a couple good places around here for takeout and everything, so yeah. I mean, a lot better than having years just in terms of like food quality and like, you know, good food versus not that not that junk food, but just like, you know, packaged food. Yeah. II do grocery delivery from from Amazon and they like for Whole Foods and I'm basically having to stop it because they they mark up, they mark up prices like horrendously on it. Which is kind of just, which is just awful. And it's kind of like way worse over the past couple of years, so I know. Yeah. Yeah, and other source, yeah. And that stuff is generally fine. But like, yeah, I mean they literally have another, you know, the regular pressure. Something is like that much cheaper and it's just, I don't know, it's it's interesting. I guess people don't pay attention. Yeah, we do. We do. Yeah, I mean, I'm sure that's a big part of it. Yeah, I bet. No, I I've been paranoid about that for a while. She's good. She's good. Yeah, yeah, probably. It's basically go back next semester. Yeah, that's been a good, it's been a good time. It's it's needed. I mean, II people should probably do a little bit more often I think. We do, yeah. Yeah, we get kind of hard to not have it because in the afternoons it gets there's like a big Western, like Windows, and it gets hot. I mean the house will get easy easily to above 80 without air conditioning or like even with sand so if you can get really warm for a couple hours so. Yeah, it's gorgeous, but it's yeah, it gets really warm. Yes, you too. OK. Well, it's good to hear because you're doing good. Yeah. Nice. Yeah, that's good. Makes you quite happy. Look at that. Yeah, yeah. That's good. Of course, yeah. Well, OK. All right. Yes, I'll send it down right after this. Great. Love you. Talk to you soon. Bye, bye. Ah. G. It wouldn't let me go right to that. OK I was. Hello, Mr Jinto. I don't know. I mean, first, the amount of time I'll be up, I have no idea. You still doing the catching? Yeah. Well, I mean, like, I did other stuff today, so I went to laundry. And so. You're sad. I'm always sad. I mean that that too, but also. That meant **** It does mean **** technically not even though. Thank you. Thank you, honey. Yes, ma'am. For us explaining to Sage how like, I'll wait for us both to be in the bed and then suddenly bond, and then next doing air chops and like specifically biting our wings. Like that wing is neat. It doesn't lay me down. Let me try to bring. Yes, like really low effort. Gentle. Oh, my gosh. Make two transfers to get, like, the money actually visible. OK. Yeah. OK. I'll. I'll let me think that. I'm sorry. Yeah. First thing I'm gonna do in the morning actually is try to get gas to make sure. I think it usually does like. Like the payments usually don't like process all the way through, but like once I like click paid, it usually lets me use the code. Nitrogen 's. Don't destroy any more than it already is. My gosh. Hiking. Will be helpful whatever projects they've got going on. Yeah, yeah. Well, yeah. None. Now I guess let me know when you're you're done with your whatever you need to get done. My little. And we'll try to be companies. Yeah. I'll actually have a veto. Well, there's tell them a good picture. Yep. Wow. Wow. Wow. I can't believe you said that **** Me too. Yeah. 8. Yeah. Hit that. OK what OK? That's. No it doesn't. We can. No. Wait. Well. Add. Like 500 bucks. It was like crazy high and also you can be working multiple people and you have sort of a. I don't know like. That is also. Yeah. Yeah. Yeah. Facebook. What diary do you have? I think everything will definitely be. Ajit. Call here. No brightness. Yeah. Hello, Ian. OK. ---
name: debugging
description: Use when investigating bugs, fixing test failures, or troubleshooting unexpected behavior. Four-phase root cause methodology. NO FIXES WITHOUT ROOT CAUSE FIRST.
---

# Systematic Debugging

**Grounding:** SOUL.md mental models — *Occam's razor* (simplest explanation, debug accordingly), *Map vs territory* (code is truth, not docs). Values — *Correctness over speed*. Known bias — *Anchoring* (over-weighting first approach).

## Core Principle

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

Never apply symptom-focused patches. Understand WHY something fails before attempting to fix it.

## Phase 1: Root Cause Investigation

Before touching any code:

1. **Read error messages thoroughly** — every word matters
2. **Reproduce consistently** — if you can't reproduce it, you can't verify a fix
3. **Examine recent changes** — what changed before this started failing?
4. **Trace data flow** — follow the call chain to where bad values originate

**Root cause tracing:**
```
1. Observe symptom — where does the error manifest?
2. Find immediate cause — which code directly produces the error?
3. Ask "what called this?" — map the call chain upward
4. Keep tracing — follow invalid data backward through the stack
5. Find original trigger — where did the problem actually start?
```

Never fix where errors appear — trace to the original trigger.

## Phase 2: Pattern Analysis

1. **Find working examples** — similar code that works correctly
2. **Compare implementations** — don't skim, read fully
3. **Identify differences** — what's different between working and broken?
4. **Check dependencies** — what does this code depend on?

## Phase 3: Hypothesis and Test

One variable at a time:

1. **Formulate ONE hypothesis** — "the error occurs because X"
2. **Predict the outcome** — what should happen if hypothesis is correct?
3. **Run minimal test** — change ONE thing
4. **Compare prediction to result**
5. **Iterate or proceed** — refine if wrong, implement if right

## Phase 4: Implementation

1. **Create failing test** — captures the bug behavior
2. **Implement single fix** — address root cause, not symptoms
3. **Verify test passes** — use verification skill
4. **Run full test suite** — ensure no regressions

## Stop Conditions

**If 3+ consecutive fixes fail: STOP.** This signals architectural problems requiring discussion, not more patches.

**Stop immediately if thinking:**
- "Quick fix for now, investigate later"
- "One more fix attempt" (after multiple failures)
- "This should work" (without understanding why)
- "Let me just try..." (without hypothesis)

## Common Scenarios

**Hook fails silently:** Check exit code, pipe `2>&1` to capture stderr, enable tracing via `/construct trace`.

**Test passes locally, fails in CI:** Environment diff — check paths, CWD, env vars, installed binaries.

**"It worked before":** `git bisect` to find breaking commit. Compare the change.

## Checklist

Before claiming a bug is fixed (see verification skill):

- [ ] Root cause identified and can be stated in one sentence
- [ ] Hypothesis formed and tested
- [ ] Fix addresses root cause, not symptoms
- [ ] Test reproducing the bug exists
- [ ] Full test suite passes
- [ ] Fix is minimal and focused
