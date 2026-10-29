# Service Simulator v1 (Excel): build prompt

Purpose: a prompt to paste into an AI assistant (for example Glean) to build the first version of the service simulator as an Excel workbook. It overlays an 18-month demand plan (SKU–customer) on a supply plan (SKU–plant) and a truck plan (plant–customer), predicts service by month, and splits lost service into supply cuts and transport cuts under demand-variance scenarios.

## Before you use it

- **Ownership.** A workbook built with company AI, on company time or with company data, is likely company property, and prompts to company AI may be logged. Keep the consultancy version separate: build it on your own time and equipment, never load company data into it, and check your employment contract for outside-business and IP-assignment clauses.
- **File output.** If the assistant cannot create an .xlsx, the prompt asks it for a Python (openpyxl) script that builds the file instead.
- **Long prompts.** If the answer is cut off, send it in three parts: (1) Settings, inputs and sample data, (2) calculation sheets, (3) Dashboard, Checks and Sensitivity. Start each part with "Continue building Service Simulator v1 from the spec below".

## The prompt

```
You are an expert supply chain planner and Excel model builder. Build an Excel workbook called "Service Simulator v1". It overlays an 18-month demand plan on a supply plan and a truck plan, predicts customer service by month, and shows whether lost service comes from supply shortfall or transport shortfall, under demand-variance scenarios. Results must be visible at overall, SKU, customer and lane level.

OUTPUT REQUIREMENTS
- Deliver a downloadable .xlsx. If you cannot create files, give a complete Python script using openpyxl that builds the workbook exactly as specified, including the sample data.
- Formula-driven: every calculated cell is a live Excel formula, so changing any input recalculates everything. No macros or VBA, no Power Query, no external links.
- Use Excel Tables for every input and named cells for every setting. Avoid volatile functions (OFFSET, INDIRECT, TODAY) in calculations. Use SUMIFS, XLOOKUP or INDEX/MATCH, MIN, MAX, ROUNDUP, IFERROR.
- Units are pounds (lbs) everywhere. Dashboard figures show MM lbs (millions) with one decimal.
- Input cells light yellow, formula cells white. Protect formula cells without a password.
- Months are M1 to M18. Show headers as Mmm-yy using EDATE from the PlanStart setting.

SHEETS

1. README
   Purpose, how to load data, how to run a scenario, colour key, status rules, and the v1 limitations listed at the end of this spec.

2. Settings (named cells)
   - PlanStart: first month of the plan (date).
   - DemandVarGlobal: demand variance %, default 0%. Actual demand = plan x (1 + variance). Example: 100 MM lbs at -5% = 95 MM lbs.
   - TransportDelayPct: share of lane truck capacity lost to delays, default 0%.
   - TruckCapDefault: lbs per truck, default 40,000.
   - FrozenMonths: months that cannot be re-planned, default 2.
   - PrebuildWindow: how many months earlier supply can be produced, default 2.
   - MatchTolerance: gap treated as matched, default 2%.
   - ServiceTarget: default 98%.
   - AllocationRule: dropdown, ProRata or Priority.

3. SKU_Master: SKU, Description, Product Family, Shelf Life (months).
4. Customer_Master: Customer, Priority Tier (1, 2 or 3), Region.
5. Plant_Capacity: Plant, M1..M18 capacity in lbs.
6. Demand_Plan (input, SKU-customer level): SKU, Customer, M1..M18 lbs.
7. Supply_Plan (input, SKU-plant level): SKU, Plant, M1..M18 lbs.
8. Opening_Inventory: SKU, Plant, Qty lbs.
9. Sourcing: SKU, Customer, Plant, Share %. Shares for each SKU-customer add to 100%.
10. Lanes: Plant, Customer, Truck Capacity lbs (blank = TruckCapDefault), Transit Days (information only in v1), M1..M18 trucks allocated.
11. Scenario:
   - SKU override table: SKU, Demand Var % (blank = not set).
   - Customer override table: Customer, Demand Var % (blank = not set).
   - Effective variance for a SKU-customer = SKU override if set, else customer override if set, else DemandVarGlobal.
   - Lane delay override table: Plant, Customer, Delay % (blank = TransportDelayPct).

CALCULATION SHEETS
Prefix each with c_. Every sheet has the row keys first and the same M1..M18 columns. Show one block per measure, with a clear header for each block.

c_Demand (one row per SKU-customer-plant from Sourcing)
- PlanDemand = Demand_Plan qty x Share %.
- EffVar = effective variance, as defined in Scenario.
- ScenarioDemand = PlanDemand x (1 + EffVar).

c_Plant (one row per SKU-plant)
- PlanDemand, ScenarioDemand = SUMIFS from c_Demand.
- Supply = Supply_Plan.
- Available(M) = EndInv(M-1) + Supply(M). EndInv(0) = Opening_Inventory.
- SupplyFill(M) = MIN(Available(M), ScenarioDemand(M)).
- Shipped(M) = SUMIFS of Shipped from c_Customer.
- EndInv(M) = Available(M) - Shipped(M). Stock held back by trucks stays at the plant for next month.
- Gap(M) = Available(M) - ScenarioDemand(M). Positive means surplus.
- CumGap(M) = Opening_Inventory + cumulative Supply to M - cumulative ScenarioDemand to M.
- MonthsOfCover(M) = EndInv(M) / average ScenarioDemand of the next 3 months (blank if no demand).
- AgeRisk(M) = flag when MonthsOfCover >= Shelf Life - 1.

c_Customer (one row per SKU-customer-plant)
- Supply allocation when the plant is short:
  - ProRata: AllocSupply = ScenarioDemand x (plant SupplyFill / plant ScenarioDemand).
  - Priority: fill tier 1 first, then tier 2, then tier 3. Tier fill ratio = MIN(1, MAX(0, plant SupplyFill - demand of higher tiers) / demand of this tier). AllocSupply = ScenarioDemand x own tier fill ratio. Show the helper columns.
- LaneRatio from c_Lanes.
- Shipped = AllocSupply x LaneRatio.
- SupplyCut = ScenarioDemand - AllocSupply.
- TransportCut = AllocSupply - Shipped.
- Service % = Shipped / ScenarioDemand (blank if demand is 0).

c_Lanes (one row per plant-customer)
- Load = SUMIFS of AllocSupply across SKUs.
- TruckCap = lane value, else TruckCapDefault.
- Delay = lane override, else TransportDelayPct.
- Capacity = Trucks x TruckCap x (1 - Delay).
- TrucksNeeded = ROUNDUP(Load / TruckCap, 0).
- TruckGap = Trucks - TrucksNeeded.
- LaneRatio = IF(Load = 0, 1, MIN(1, Capacity / Load)).

c_Status (one row per SKU, summed across plants, plus one Overall row)
- Green: Available >= ScenarioDemand x (1 - MatchTolerance).
- Amber (short this month, but fixable by producing earlier): month is after FrozenMonths, CumGap(M18) >= 0, and spare plant capacity (Plant_Capacity - Supply, summed over the SKU's sourcing plants) in months MAX(FrozenMonths + 1, M - PrebuildWindow) to M - 1 covers the shortfall.
- Red: short and not Amber.
- Add a "T" marker when TransportCut > 0 in that month.

DASHBOARD
- Scenario panel: current DemandVarGlobal, TransportDelayPct and AllocationRule, with links to Settings.
- KPI tiles: 18-month service %, total cuts (MM lbs), share of cuts from supply vs transport, months below ServiceTarget, count of Red SKU-months, count of lane-months short of trucks.
- Overall table (months as columns): Plan Demand, Scenario Demand, Supply, Projected Inventory, Monthly Gap, Cumulative Gap, Service %, Supply Cuts, Transport Cuts, Status.
- SKU heatmap: SKU rows x months, cell colour from status, value = service %.
- SKU drill-down: a dropdown to pick a SKU, then its monthly table, a line chart (scenario demand, supply, ending inventory) and a stacked column chart of cuts by cause.
- Customer view: customer rows with 18-month service %, supply cuts and transport cuts.
- Lane view: plant-customer rows x months showing trucks allocated vs needed, red where short.
- A red banner at the top if any check on the Checks sheet fails.

CHECKS (PASS or FAIL for each)
- Total PlanDemand in c_Demand equals the total of Demand_Plan.
- Every SKU-customer in Demand_Plan has Sourcing shares adding to 100%.
- Every plant-customer in Sourcing has a row in Lanes.
- Every SKU and customer in the plans exists in the masters.
- No negative ending inventory.
- Shipped + SupplyCut + TransportCut = ScenarioDemand for every row.

SENSITIVITY
A table of 18-month service % for DemandVarGlobal from -10% to +10% in 2.5% steps, using an Excel What-If Data Table (column input = DemandVarGlobal). If you cannot create the data table, build the layout and write the steps to create it: Data > What-If Analysis > Data Table.

SAMPLE DATA (fictional names only)
- 6 SKUs, 5 customers, 2 plants, 18 months.
- Demand per SKU-customer between 0.2 and 2.0 MM lbs per month, with mild seasonality.
- Supply roughly matches demand overall, except: one SKU short in months 5-6 but fixable by producing earlier (Amber); one SKU short in month 2, inside the frozen window (Red); one lane with too few trucks in months 8-9 (transport cut).
- Each status and each cut type should appear when the file opens.

ACCEPTANCE TESTS (run them and report the results)
1. Variance 0% with the sample data: all checks PASS.
2. DemandVarGlobal = +5%: scenario demand rises 5% everywhere, cuts appear where supply is tight, service % falls.
3. DemandVarGlobal = -5%: no new cuts, ending inventory rises, age-risk flags may appear.
4. Set one lane's trucks to 0 for one month: that lane's TransportCut equals its AllocSupply for that month, and plant ending inventory rises by the same amount.
5. AllocationRule = Priority: in short months, tier 1 service >= tier 2 >= tier 3.

V1 LIMITATIONS (put these in README)
- Monthly buckets. Transit days are shown but do not move volume between months; delays are modelled as lost truck capacity.
- Cuts are lost sales, not backorders.
- The pre-build check uses total plant capacity, not line or SKU capacity.
- Age risk uses months of cover, an approximation of first-in-first-out ageing.

When done, list the sheets, the named cells, and the result of each acceptance test.
```

## Roadmap after v1

- Backorders as an option instead of lost sales.
- Weekly buckets for the first 3 months, monthly after.
- Transit time moving volume across months.
- Saved scenarios side by side (plan vs scenario A vs scenario B).
- Variance bands from forecast-accuracy history per SKU, instead of one flat percentage.
- Distribution centres between plants and customers.
