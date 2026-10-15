# Example task: count the bits of a byte

A small task for a first run. It takes a minute to score and a few rounds to exhaust.

- **The design** is `program.txt`: a straight-line program that reads a byte `x` and must leave
  the number of its one-bits in `out`.
- **The evaluator** is `node evaluate.mjs`. It runs all 256 inputs, so its answer is exact. It
  prints the score, or the inputs the program gets wrong.
- **The score** is operations x registers, lower is better. So a register has a price in
  operations: at the seed, 22 operations x 3 registers = 66, and one register is worth about 7
  operations.
- **Editable**: `program.txt` only. `evaluate.mjs` is not to be touched.
- **The cheapest test** is the evaluator itself.
- **Case by case**: `node evaluate.mjs <program> --cases` prints one line for each input, so two
  programs can be compared on the same inputs with `rpf pair`.
- **Nothing here needs the operator's word.** The floor: a gain of 2 points.

To run it, install the skill into this folder and ask your agent:

> Use the rpf skill on the task in task.md. Run two rounds.
