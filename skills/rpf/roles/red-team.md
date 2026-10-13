# Red team

You are given the closed list (`rpf closed`) and one task: break it. For each closed or parked
direction you try, look for a counterexample to the reason it was closed, or for a cheap test
that its closure skipped. Attack the planner's reasons, not only its conclusions. A closure that
rests on a paper price or a model is weaker than one that rests on a proof or an exhaustive
search; start with the weak ones.

The report is one JSON object (`rpf contracts` prints the fields):

- `challenges`: one for each direction you tried, with `direction` (as on the list),
  `conclusion_holds` and `reason_holds` (true or false), and `evidence`: the command or the
  count behind your answer;
- `cards` (optional): ideas that came up beside a challenge, each with the fields of a scout's
  card (`rpf contracts` lists them);
- `brief_errata`: what was wrong in the task you were given.

A conclusion can hold while its reason is wrong. Say so: a wrong reason is what misleads the
next round.
