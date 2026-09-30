# Reddit draft (not posted)

Suggested subreddits: r/webdev or r/javascript. Check each sub's self-promotion rules before posting.

**Title:** made a tool that replays a failing browser session and finds which api field or timing actually causes the bug

**Body:**

so i kept running into bugs where the failing run and a working run differ in a ton of ways, some response field is null, some request came back slower, there's some leftover thing in localstorage, and figuring out which one actually matters was always me commenting stuff out until something changed, so i built causality cage which takes a recorded failing session and a passing one, replays the flow in chromium with those differences switched on and off, and uses delta debugging to shrink it down to the smallest set that still breaks, then it checks the answer again by taking each piece away one at a time

i tried it on a real closed issue in the realworld react redux example app (#187), the one where the home page crashed reading 'tags' of undefined and the person who reported it figured out it was a stale token left in localstorage from another backend, and on that exact commit cage came back with the stale token plus the api rejecting the two requests that token triggers, 19 experiments and 25.1 seconds

the first version actually got this slightly wrong, it just said the token, because in its minimal setup the page crashed with a different error than the original and it counted any crash as the bug, so now it takes a fingerprint of the original failure and only counts runs that fail the same way, and there's a --loose-oracle flag if you want the old behavior. that same case also caught the report leaking the first part of a secret through a truncated sentence, both fixed now

the thing i tried hardest to get right is it not making stuff up, if the cause is something it doesn't model like server side state or websockets it just says unexplained, and every report has a box saying exactly what the claim does and doesn't cover

it's all local, no llm, spits out one html report and can export a playwright test that fails until you fix the bug. npm install -g causality-cage, repo is github.com/zaydmulani09/causality-cage, would love to hear where it falls over on your stuff
