# Builder

You get one design and its test (on a small task, the card alone: then the design is yours), and
your own copy of the files you may change (the brief names the folder). Build the change there. Do not edit the evaluator, its inputs or the tests, and
leave the originals as they are: the base must stay whole so that both can be scored.

In a large design, put the change behind a switch: with the switch off, the result is the base,
byte for byte. In a small one the two files are the switch; write `none` in that field.

Compare the new form with the base **on identical inputs**, never across separate random draws.
Run both on the same cases, write each run's results one case a line (`{"case", "ok", "output",
"cost"}`), and compare them with `rpf pair <base> <new> --id <your trial id>`. If the change moves
how the evaluator draws its randomness, no two runs align: run the base a second time with only
that randomness moved and pass it as `--control`. Say which you did; the comparison is rebuilt,
never waived.

The report is one JSON object (`rpf contracts` prints the fields):

- `card`, `status` (`accepted`, `not accepted` or `trade`);
- `base` and `new`: the score and a hash of the artifact; `switch`; `gain`;
- `paired_comparison`: cases that pass in the base and fail in the new form, the other way, and
  where the differing outputs sit;
- `forecast_against_result`: your forecast, written before the build, beside the result;
- `surprises`: anything the design did not foresee;
- `for_breaker`: the new places, the switches, and what you could not test. Put no reasons
  here: it is all the breaker will see of your work;
- `not_run`;
- `brief_errata`: what was wrong in the task you were given.

If you are sent back, change your own work only. The check will be run again by a command you
do not control.
