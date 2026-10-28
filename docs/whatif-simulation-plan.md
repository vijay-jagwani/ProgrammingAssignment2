# What-if simulation: plan, workflow and build prompt

Status: planning only. Nothing here is built yet. Decide section 1 first, then work through the phases in order. Each phase ends with a gate.

## 0. One-line idea

A planner enters their own numbers, changes one lever (forecast, production, transport, price), and sees what happens to service, inventory, aged stock, cost and profit, across many random runs, compared against a baseline.

## 1. Decisions to make before building

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | What is the product? | (a) Training tool on the existing game, (b) standalone scenario sandbox, (c) consulting-led pilot using the sandbox | Test (c) first with 5–10 planners, build (b) only if they want it |
| D2 | Who is the first user? | Demand planner, S&OP lead, plant or ops manager, finance | S&OP lead: owns both service and cost |
| D3 | Which industry first? | Food/consumer goods, auto parts, other | Food or consumer goods, mid-size, small planning team |
| D4 | Data input | Manual entry, CSV upload, ERP connector | CSV upload with a fixed template. No connector until a pilot needs one |
| D5 | Does price change demand? | Yes (elasticity), no (fixed demand) | Confirm the engine's current behaviour before promising price levers |
| D6 | Is the output a forecast? | Forecast, or sensitivity only | Sensitivity only. Label it that way on every screen |

## 2. Levers and the chain each one sets off

Each lever changes one input, holds the rest fixed, and is compared with the baseline on the same random draws.

| Lever | Change | Engine path | Expected effect on service | Expected effect on cost |
|-------|--------|-------------|----------------------------|--------------------------|
| Forecast | ±X% on SKU forecast | Forecast → production and purchase plan | Forecast too high: no service gain if demand does not follow. Too low: stockouts | Too high: holding, ageing and write-off. Too low: lost sales |
| Production | Produce +X% or −X% vs plan | Allocation → output → shelf stock | Above demand: no gain. Below demand: stockouts and fill-rate drop | Above: production and holding cost, age loss. Below: lost revenue |
| Transport mode | Truckload vs intermodal per lane | Lane lead time → pipeline stock | Intermodal: longer pipeline, higher safety stock needed | Truckload: higher cost per unit. Intermodal: lower cost, more stock in transit |
| Transport share | Split between modes | Mix of lead times | Mix trades service against cost | Mix trades cost against stock held |
| Price (if D5 is yes) | ±X% on price | Demand response | Higher price: lower demand | Revenue and margin change |

## 3. Outputs (what the screen shows)

| Metric | Source field today | Status |
|--------|--------------------|--------|
| Fill rate | `fillRate` | Exists |
| Stockout units | Not a separate field (derived from ordered − fulfilled) | Gap: add a field |
| Ending stock units | Inventory in state | Exists; confirm the field name |
| Aged or expired units | Age loss exists (`ageLossCost`); the expired count appears in the final learnings | Confirm a unit count is tracked, add if not |
| Holding cost | `holdingCost` | Exists |
| Age loss | `ageLossCost` | Exists |
| Production cost | `productionCost` | Exists |
| Transport cost | `transportCost` | Exists |
| Revenue, profit | `revenue`, `profit` | Exists |
| Cash tied up in stock | Derived: stock units × unit cost | Derived, no new engine work |

Every number on screen must show: the baseline value, the scenario value, the difference, and the spread across runs (P10 to P90).

## 4. Scenario method

1. **Baseline:** run the planner's current plan N times (N = 50 by default), using a different seed each time.
2. **Scenario:** change one lever, run the same N seeds. Using the same seeds means the same random draws, so differences come from the lever.
3. **Summarise:** report P10, median and P90 for each metric, not a single run.
4. **Frontier:** plot each scenario as a point on fill rate against total cost. The points show the trade-off directly.
5. **Combinations:** allow two levers at once, but keep one-at-a-time sensitivity as the default view.

## 5. Workflow (phases and gates)

**Phase 0: Think and validate (no code)**
- Work through D1 to D6 with the owner.
- Write the mock dashboard with sample numbers: "a 10% forecast miss costs X in fill rate and Y in aged stock."
- Interview 5–10 planners. Ask: what do you check first, what data can you give in a week, what do you already use?
- Gate: at least 3 planners say they would run this on their own data. Otherwise stop, or fall back to a training tool.

**Phase 1: Specification**
- Write the input template (SKU, demand history, forecast, lead times by mode, unit cost, holding and ageing cost, service target).
- Write each lever's allowed range and what counts as a valid input.
- Define each metric exactly, as in section 3.
- Gate: the owner signs off on the template and the metric definitions.

**Phase 2: Engine (pure functions, no UI)**
- Add a scenario runner that calls the existing reducer headlessly, once per seed, and returns distributions.
- Add the missing outputs (stockout units, and an expired-unit count if needed).
- Gate: unit tests pass (section 6), and the existing 44 engine tests still pass. The multiplayer and solo browser tests still pass.

**Phase 3: Calibration**
- Load one anonymised or sample history and compare the simulated fill rate and stock with the known actuals.
- Record the gap and what the gap means for the sales claim.
- Gate: the gap is small enough to explain, and the limits are written down for the buyer.

**Phase 4: Interface**
- One screen: input panel, baseline vs scenario, frontier chart, and a plain-English summary of each result.
- Every number has its spread and a note that it is sensitivity, not a forecast.
- Gate: a planner can run a scenario without help, measured on 3 people.

**Phase 5: Pilot**
- Run on the buyer's own data for two weeks, with a fixed list of questions they want answered.
- Gate: the buyer says the answers changed a decision. Otherwise, the product is not yet proven.

## 6. Acceptance tests

Ceteris paribus checks (one lever changes, everything else fixed):

- More production than demand, no demand change: holding cost and age loss rise; fill rate does not improve.
- Less production than demand: fill rate falls; stockout units rise.
- Forecast up, demand unchanged: production and holding cost rise; fill rate does not improve.
- Intermodal instead of truckload on a lane: transport cost per unit falls; pipeline stock rises.
- Same seed twice: identical results (determinism).
- Baseline run against itself: zero difference.
- Fill rate stays between 0 and 1.

## 7. Build prompt (for the next session, after Phase 0 gate)

Copy the block below into a new session once the decisions in section 1 are made. Fill in the bracketed parts.

```
Build a what-if scenario runner for this repo.

Context:
- shared/src/engine.ts has a pure reducer reduce(prev, action). Results per team per month include fillRate, productionCost, transportCost, holdingCost, ageLossCost, revenue and profit (shared/src/types.ts).
- Randomness is seeded through rand01 in shared/src/rng.ts.
- Do not change game rules for existing multiplayer or solo games. Existing tests must still pass.

Task (Phase 2 only, no UI):
1. Create shared/src/whatif.ts exporting runScenario(baseline, levers, seeds) that runs the reducer headlessly once per seed, applies the levers as input changes, and returns P10, median and P90 for each metric in section 3 of docs/whatif-simulation-plan.md.
2. Add the missing outputs: [stockout units; expired units if not tracked].
3. Add tests in shared/test/whatif.test.ts for every item in section 6 of docs/whatif-simulation-plan.md.
4. Keep a fixed [N = 50] seed list so runs are reproducible.
5. Run npm test and npm run typecheck. Run node scripts/sync-shared.mjs and check the edge-function copy is in sync.

Done means: all tests pass, no UI changes, and a short summary of the metric definitions as implemented.
```

## 8. Open questions

- Does the engine model price response to demand? (Decides whether the price lever is in scope.)
- Does the engine track expired units separately from age loss?
- What is the realistic range of N for a browser? (50 runs should be fast; confirm once built.)
- How will the sales claim be worded so it is not a forecast promise? (Needs a legal or sales review before any customer sees it.)
