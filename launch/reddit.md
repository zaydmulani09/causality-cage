# Reddit draft (not posted)

Suggested subreddits: r/webdev or r/javascript. Check each sub's self-promotion rules before posting.

**Title:** made a tool that replays a failing browser session and finds which api field or timing actually causes the bug

**Body:**

so i kept running into bugs where the failing run and a working run differ in a ton of ways, some response field is null, some request came back slower, there's some leftover thing in localstorage, and figuring out which one actually matters was always me commenting stuff out until something changed, so i built causality cage which takes a recorded failing session and a passing one, replays the flow in chromium with those differences switched on and off, and uses delta debugging to shrink it down to the smallest set that still breaks, then it checks the answer again by taking each piece away one at a time

i tried it on a real closed issue in the realworld react redux example app (#187), the one where the home page crashed reading 'tags' of undefined and the person who reported it figured out it was a stale token left in localstorage from another backend, and on that exact commit cage said localstorage jwt was the cause in 10 experiments and 14.9 seconds, which honestly surprised me a bit

there's a caveat i wrote up though, in the minimal setup the page crashed with a slightly different error than the original, because the tool doesn't check that it's the same failure, and when i gave it an oracle that only counts the exact error from the issue it came back with the whole chain instead, the stale token and the api rejecting two of the requests, which is actually the real mechanism. that run also caught two bugs in my own tool, one was the report leaking the first part of a secret through a truncated sentence, both fixed now

the thing i tried hardest to get right is it not making stuff up, if the cause is something it doesn't model like server side state or websockets it just says unexplained, and every report has a box saying exactly what the claim does and doesn't cover

it's all local, no llm, spits out one html report and can export a playwright test that fails until you fix the bug. npm install -g causality-cage, repo is github.com/zaydmulani09/causality-cage, would love to hear where it falls over on your stuff
