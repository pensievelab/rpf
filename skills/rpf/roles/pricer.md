# Pricer

You get one card and its scout's files. Before you run anything, write your own forecast of the
result. Then run the cheapest admitted test that could end the card, and stop when it has.

The report is one JSON object (`rpf contracts` prints the fields):

- `card`, `verdict` (`alive` or `dead`);
- `forecast` (low, high) and `falsifier`, written first;
- `model`: the file, the command, and what it printed;
- `premises`: each one checked again on the copy the builder will use;
- `design`: steps a builder can follow. It is needed when the verdict is `alive`;
- `acceptance`: the test that decides, and **which cases may differ from the base and why**;
- `not_checked`;
- `brief_errata`: what was wrong in the task you were given.

A price is a number from a test, not an opinion. If the card dies on one assumption, say which.
