---
name: rpf
description: Recursive Priced Falsification. Run an autonomous discovery loop on anything an automatic evaluator can score (a program, a circuit, a model, a proof). Use when asked to improve a score over many rounds without supervision. You act as the planner; workers run in fresh contexts; a shared record on disk holds the state.
---

# Recursive priced falsification

You are the **planner**. You hold the map of what the design costs and you write every task as a
trial. You do not write the design: workers do, each in a fresh context. You do run the
evaluator and the checks yourself, because a claim counts only after you have re-run it. Nothing
that matters lives in your conversation: it lives in the record (`.rpf/`).

The tools are one command, `rpf` (with no arguments it lists them, with every flag). If `rpf` is
not on your path, it is `node scripts/rpf.mjs` in this skill's folder; `rpf` below means either.

## Before the first round

1. Run `rpf init`. It makes the record, and in it `.rpf/workflow.md`: your own copy of this text.
   From here on that copy is the workflow you follow, and it is yours to revise.
2. Find out four things and write them to `.rpf/task.md`. Take them from the task's own files
   where they are given; ask the operator, once, only for what is missing.
   - the **evaluator**: the command that scores the design, and whether lower or higher is better;
   - the **editable paths**, and what must not be touched (the evaluator, its inputs, the tests);
   - the **cheapest test**: the fastest command that can show a change is wrong;
   - what needs the operator's word (anything with an effect outside this folder: spending,
     publishing, messages), and the **floor**: the smallest gain worth a trial. If no floor is
     given, use 0.1% of the score.
3. Ask in the same message for three things that save hours later, where they apply:
   - a **standing rule** for what may go out without asking (for example: exact changes, under a
     spend of N), so that a tested gain is not held while the frontier moves. Trades, and anything
     that raises a risk above the base's, stay the operator's;
   - **bounds for paid compute** (per hour, hours, machines) and where long jobs run. Jobs longer
     than about ten minutes do not run on the planner's machine;
   - the **frontier**: the command that prints the best score outside this run (a leaderboard, a
     rival's release), if there is one. Name it once: `rpf frontier --cmd "<command>" --better lower|higher`.
4. Make the evaluator, or a wrapper around it, able to print **one line a case**:
   `{"case", "ok", "output", "cost"}`. `rpf pair` compares two designs from these files. Where the
   evaluator draws random inputs, fix them (a seed, or a saved set).

Do not ask the operator anything else during a round.

## A trial

Every task you hand out is a trial with a stake known before it runs. `rpf brief` writes it:

- the **question**, one a script could answer;
- **your forecast** of the answer. It is recorded first, beside the brief, and left out of the
  worker's task. Write a number (`52`), a range (`40 to 60`), or for a yes-or-no question a chance
  (`0.3`). For a scout, forecast the size of the best card it will bring; for a breaker or a red
  team, the chance that it breaks something;
- the **falsifier**: the result that ends the idea;
- the **stake**: a bound in minutes, and one deliverable the worker can finish in one run;
- the **reading list**: the only files the worker may read.

The worker writes **its own forecast** before it runs anything, and its report must say **what
was wrong in your task** (`brief_errata`). You are scored on both (`rpf score`).

Rank trials by expected gain for each minute of stake, not by their chance of success. Most
trials should lose, and lose on a cheap test. The loss is capped by the stake; the gain is not.

## One round

| # | Hop | Who | Hands on |
|---|---|---|---|
| 0 | Measure | you, with scripts | `.rpf/map.md`: the design's cost by block, each resource limit priced again, the closed list |
| 1 | Scout | 2 to 4 workers, one lens each | cards in `.rpf/cards/<brief id>.jsonl` (`roles/scout.md`); at a floor, thinkers (`roles/thinker.md`) |
| 2 | Desk | `rpf desk` | picks: the best card of each lens, two more by value, one long shot |
| 3 | Price | one worker a pick | a price report with a design (`roles/pricer.md`) |
| 4 | Build | one worker a design, in its own copy | a build report (`roles/builder.md`) |
| 5 | Merge | you | the accepted changes in one design, scored again by the evaluator, on the same inputs as the base |
| 6 | Break | one worker, fresh context | BROKEN or NOT BROKEN (`roles/breaker.md`) |
| 7 | Verify | you | the evaluator's own score of the merged design, which becomes the new base |
| 8 | Red team | one worker | challenges to the closed list (`roles/red-team.md`) |
| 9 | Revise | you | the next version of `.rpf/workflow.md`, as a trial |

How the hops are run:

- **Start each worker in a fresh context.** Use your host's sub-agents if it has them, and give
  the worker the brief file as its whole task. If it has none, `rpf worker --brief <file>` starts
  a new headless session and stops it at its stake. Either way the worker gets its role, its task
  and its reading list, and nothing of what you believe. One worker a round reads no earlier
  report at all.
- **Read the frontier first** (`rpf frontier`), before each round and before anything you say
  about it, and one thing from outside (the latest change at the top, a paper). It moves while you
  work, and an hour-old reading has been wrong. While a paid job runs, `rpf frontier --watch`
  returns when the top moves.
- **Start from a measurement, not from a list of ideas.** A card that comes from the cost map
  arrives with its price. Instruments come before ideas: the tests that can kill an idea in
  seconds, and a ledger of where the cost sits, found more than lists of ideas did. Admit an
  instrument only after it reproduces the base's own number and catches a fault you planted.
- **Measure the map again after every paid change.** A setting pays only when a price it was
  fitted to has moved; settings that share a resource are swept together, not one at a time.
- **Give each scout a different lens** (`rpf brief --lens`). A lens is one way of looking for a
  gain: the dearest block of the cost map ("this block does its job a dearer way" made the large
  steps); the scarcest resource; what has just paid, taken further; a closed direction and the
  number that would reopen it; how another field does this. A literature scout holds one
  technique that has already paid here and looks for its relatives; a scout handed only a topic
  rarely finds one. A lens that came back dry is not run again unchanged.
- **Read the record before you forecast.** `rpf desk` moves each card's odds towards what its
  family has paid at its stage, and prints that record; `rpf score --by family,stage` gives all of
  it. Forecasts err by stage: first builds of a new form came in well over forecast, sums of
  measured parts close to it, and a paper price errs both ways. Before closing an idea on a paper
  price, test its dearest untested part.
- **One change, one card.** Before the desk, leave out a card that proposes the same change as
  another, whatever lens it came from: `rpf desk --drop <ids>`. The desk itself sets aside cards
  that fail their contract. Where two picks are alternatives, build the one ranked first.
- **Check every report** with `rpf check <card|price|build|break> <file>` before the next hop
  builds on it, and re-run one key number of it yourself with one command.
- **Hand-overs go on disk, hop to hop.** `rpf brief --card <id>` puts a scout's card in a
  pricer's task. `--from <report>` puts in the report of the hop before: a builder gets the
  design and its test; a breaker gets the change and the claim and never the reasons.
  `--copy <paths>` gives a builder its own copy of the editable files under `.rpf/work/<id>/`.
- **Record a trial only after you have re-run the test behind its claim**:
  `rpf trial --id <id> --result <number> --outcome <paid|alive|dead>`. *Paid*: a gain entered the
  accepted design (one trial of a chain is paid, the one that built it), and its paired comparison
  is on file (below). *Alive*: the idea goes on to the next hop; for a scout, one of its cards was
  picked. *Dead*: the idea ended here; a scout whose cards were all passed over, a breaker or a red
  team that broke nothing. The result of a yes-or-no question is `1` or `0`. Record the losses
  too: they are most of the record, and they set the next round's odds. When a trial taught
  something a later round should know, keep it on that trial: `--lesson "<what>" --unless "<when
  it may not apply>"`. `rpf digest --find <words>` finds it again.
- **Keep the workers alive and bounded.** Look at the age of each worker's last write now and
  then: workers stall, or die with the session, and nothing reports it. Take every time from the
  clock (`date`), never from memory.
- **Close or park every direction** with the grade of its evidence and the number that would
  reopen it: `rpf close`. The grades, weakest first: argument, paper price, simulation (a model
  of the design, run on many inputs), measurement (the real design, built and run), exhaustive
  search, proof. A direction dropped by argument alone is parked, not closed.

## Fit the round to the task

The hops exist because the exact evaluator is usually dear. Where it is not, fold them.

- **The cheapest test is the evaluator itself**, exact and done in seconds: one worker prices and
  builds in one trial (a builder, given the card). A breaker is needed only where the evaluator
  samples its inputs and could miss a case.
- **A small design**: two scouts, and build only the pick ranked first. A scout may run the
  cheapest test itself when it takes seconds, and write the measured size on the card.
- **The red team** runs when the closed list has grown by three directions or more since its last
  run, or after a round that kept nothing. Not every round.
- **The floor is for a package**, not for each idea: changes that share one refit and one dear
  check are judged together. Parts too small to build alone have been built inside a package
  that cleared it.
- **Stop when nothing is worth a trial.** `rpf desk --floor <floor>` picks nothing when no card's
  odds times size reaches the floor. Then the run is at the floor of this design's form: say so
  with the numbers, or run a clean-sheet round. Do not spend workers on gains under the floor.
- **When the frontier moves, rebase piece by piece.** Measure each piece of the new top on your
  design, and each of yours on theirs; do not choose a base by argument. Exact work carries over;
  settings fitted to the old base do not. Porting keeps you level; it has not put anyone ahead.
- **Run the method steadily.** Rounds that hunted for one large step found less than rounds run
  as written.

## When a gate fails: send it back to its owner

The worker that owns the failed part gets it back, with its context, as one message of five
parts (`rpf recall` writes it): the check that failed, the evidence, "fix only this", the
acceptance test, and the tries left (two at most). You do not fix a worker's output.

| Gate that failed | Goes back to | With |
|---|---|---|
| A premise is false on the builder's copy | the pricer | the premise and the evidence: does the design survive without it? |
| The builder measured a difference the design did not foresee | the pricer | the difference; restate the acceptance test |
| The comparison shows cases whose verdict changes | the builder, once | is there an exact form? if not, it is a trade |
| The gain is well under the forecast and nobody knows why | the builder | the narrower question, 15 minutes |
| A pricer kills a large card on one assumption | the scout | is there a variant without that assumption? |
| The breaker breaks it | the builder | the failing cases |
| A report lacks a contract field | its author | the field (`rpf check` prints the message) |

A recall never changes the test: the check is run again by a command the worker does not
control. No worker may swap its job for an easier one; if the test cannot be built, it says so.
A worker that repeats a job with no new file or number is stopped and given a narrower job.

## What may be accepted

Exact changes only. On a comparison with the base on identical inputs: no case that passes in
the base and fails in the new form, none the other way, and every output that differs sits on a
case the base already fails. Anything else is a **trade** and goes on the operator's list with
its numbers.

- **The comparison is `rpf pair <base cases> <new cases> --id <trial id>`.** It prints the three
  numbers (outputs that differ, cases wrong in only one, differing outputs where one side is
  right) and the change in cost with its paired error. `rpf trial` will not record a gain without
  it. Comparing failure rates of two runs on separate random draws is not a comparison.
- **Choose the comparison by what the change does to the inputs.** Same inputs, by default. Where
  the change moves how the evaluator draws its randomness, no two runs align: run the base again
  with only that randomness moved, and pass it as `--control`. A change passed on 30 random draws
  has been wrong on 4 shots in 150.
- **Random draws measure a rate; aimed inputs test a claim.** A change that is not exact by
  structure goes to a breaker with aimed inputs before anything is paid for.

## Before anything goes out

A release, a public note, a paid search: each has an effect outside this folder.

- **Check the margin.** `rpf frontier --ours <score>` gives the margin against the top and the
  frontier's usual step. A margin under the usual step is likely gone before it lands: build a
  larger package rather than pay for it.
- **Release on a chain of the same bytes**: a clean copy, the evaluator's own score of it, the
  frontier read again, then send. A tested exact change that waits for a word loses value by the
  hour; the standing rule exists for it.
- **Check the text.** `rpf numbers <file>` lists every number no result file holds and every
  forbidden word (`.rpf/forbidden.txt`). Write no recipe for anything not yet sent: others read
  notes and ship the next step within hours.
- **Paid compute stays inside its bounds.** Read the balance before renting, count the machines
  after each one is destroyed, and copy the logs off first. Make the algorithm faster before you
  buy cores.

## After the round

- First record it, under the version that ran it:
  `rpf round --round <n> --version <v> --gain <gain kept> --tokens <tokens spent>`. The version
  is the one at the top of `.rpf/workflow.md`. Tokens are those the workers spent, and yours if
  your host reports them; say which in `--note`.
- A round that kept no gain: the next round is planned by a **new session**, built from the
  record and not from your conversation, and told that it may disagree. `rpf digest` writes what
  it reads: facts and prices, no plan.
- Every large block at the floor of its present form: run a **clean-sheet round**. Several
  thinkers (`rpf brief --role thinker`), each reading no record and made to start from a
  different place, each return one whole design counted on paper with its weakest assumption
  tested. Time-box it, and map each design onto the closed list before building: such rounds have
  mostly confirmed that a form is at its floor, which is worth knowing, and rarely found the gain.
- **An outside model** is used as a judge, if at all: true, false or cannot tell, on a batch that
  holds two control cards whose answers you know. Drop the batch if a control fails. As a
  forecaster it did worse than the record's own pay rates.
- **The workflow is a trial too.** Then, with the round's losses in hand, revise
  `.rpf/workflow.md` for the next round and raise its version: change hops and contracts first,
  instructions last. Under the version line, write what changed and your forecast of what it will
  do to the next rounds' yield. `rpf score` scores every version by its rounds; a new version
  becomes the best one only when its yield over two rounds or more is above the best one's. Until
  then its changes are still trials.

## What never changes

The evaluator, the cheapest test and the gate on effects outside this folder are not yours to
edit. An action with an outside effect waits for the operator's word, given in advance as a
standing rule or once for the action.
