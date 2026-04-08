# General

# Charts

Go through every chart on every page in observability.

- on pages that have two charts in the same row, the first should be a shaded area / stacked bar chart, the second should be a donut chart.  They should be shown in separate panels, not a single one, and should not share a legend.
- The donut chart should take up ~1/4 of the row on the right, the area / bar chart on the left.  +
- The donut chart should take up most of the area of its own panel, e.g. this is not great (C:\Users\crsmi\OneDrive\Desktop\2026-04-06 21_55_36-Steam.png).  Adjust how the legend displays so that it does not eat too much space vertically, consider alternatives if it's not feasible to size the chart like that.
  

- On tools, combine the tool calls / total errors cards into one, adjust the precision of total tool calls to be 1 decimal point. Add a combined p50 / p95 success rate data card.  Add a p50 and success % column to the table, remove avg, rename 'Last Use' to 'Last Used'
- On Scripts, move the 'by hook / by event' toggle to the immediate left of the granularity / date range controls.  Rename that page to 'Hooks'.  Combine total calls / errors like you just did on Tools, remove the Active Hooks card, replace with a combined p50 / p95 latency card.  Update text on the page as needed to match the rename.  Replace 'avg' with p50 in in the table, also add a 'last used' column.  Change the Active Only filter to 'Missing (#count)', default it and unused to off.
- On Skills, move the filters (Commands, Skills, Installed, Unused) to the header row to the left of the granularity and date range controls.  Rename 'Installed' to 'Missing', adjust the # in parentheses to show missing skills (present in the data but not currently installed), default 'Missing' and 'Unused' to off.  In the table, replace avg with p50, change 'Last' header to 'Last Use'

- what are all the 'null' unused skills on the Scripts page?
- the topmost hook has 'null' for its name
- 


- for Tools, make the error count in the first datacard more visible, use red / yellow / green highlighting for it, pick another color for total calls.  Same thing for p50 / p95, the p95 is barely visible, change card title to Latency.  Swap the order of the charts, put them in separate panels, do not share a legend between them.
- Move the 'dataset' control to the left of the 'Missing' filter on top, put a vertical spacer (the kind between granularity a and date range) between 'Missing' and granularity, and between Dataset and 'Missing'

              - add an 'installed' column to the table / dataset, that shows whether that tool still currently exists / is installed.  Just use a checkmark for the per-row value
Research -> session detaild

- Add all of tho





Make those changes.  Look for cases where mono fonts are being used for things that are mostly text, or vice versa.  e.g. skill names

























































