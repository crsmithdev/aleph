# UI
- put goals, todos, and habits on the left sidebar under one section, 'Life'.  Make the summaryh page display when clicking on 'life', without being a separate page itself on the sidebar

# Observability

- update all line charts to be area line charts, make line charts the default on all pages in observability
- in the controls on the right side of the header, retain only the granularity and date range controls.  Move anyhthing else back to the appropriate part of the page (e.g. in scripts, 'by hook' and 'by event' move next to 'active only')
- fold everything on the tokens page into the main observability page.  update charts to be shaded area charts, or stacked area, segmented by model.

## Tools
- put a shaded area line / stacked bar chart (toggleable) next to tool call by distribution.  Adjust width of the donut chart to be much narrower than the chart you add.  
- swap the order of the tool and server columns
- drop the % column
- add a column that shows the last use of that tool
- include stats cards similar to the observability main page at the top


## Tools Detail

- adjust project naming, make it similar to the sessions list folder column.  rename sessions list folder column to project
- put the params into the expanded area revealed when clicking on a row, replace that column with the time the call took
- make the chart a shaded area / stacked bar chart, segmented by project
- add a donut chart next to the existing chart, much narrower than it, that breaks down that tools usage by project.

## scripts

- move the two donut charts to the top.
- include stats cards similar to the observability main page at the top

## skills

- include stats cards similar to the observability main page at the top
- move the charts to the top, on the same line, with 'by type' much narrower.   Change to shaded area / stacked bar chart, segment by skill.
- remnove the % visualization from the table
- remove the 'all' filter, make commands and skills usable simultaneously, defaulting both to on.

## skill detail

- fix the 'undefined' and 'nan' values in the stats
- make the chart a shaded area / stacked bar chart, segmented by project
- add a donut chart next to the existing chart, much narrower than it, that breaks down that tools usage by project.
- remove the parameters column, give more room to 'request'.  Make rows expanddable and show parameters there.

## Session List

- move the daily activity of # of events to the events page
- put remaining charts on the same line, adjust the donut to be much narrower
- change the sessions chart to just be 'sessions', respecting the granularity and date range controls, put sesssions on the right axis, messages on the left, make the line chart a shaded area chart, for bar chart if possible make assistant and user messages a stacked bar chart, sessions a regular bar next to them.  adjust the scale / range of the messages data series / left axis to let the messages data take up more vertical space (different than the right axis)
- adjust the table so conversation takes up the most space, and all the rest take up minimal space.  conversation should be about half the width of the table in total,

# events
- add donut chart segmented by type.  put it above the table with the chart moved from sessions.  For the events chart, segment it by type.
- in cases where the detail is null, replace with a dash
- change 'info' to 'parameters', make sure all rows are removing the json formatting in favor of just key: value display

# memory
- change chart to stacked bar / area line
- add a donut chart, much narrower, to the same row, segmented by type.  
- remove memory count over time
- make the content of memories in the table take up thge majority of the width of it, with tags minimal

# database

- mwhen showing data table contents, chanmge the column display format to remove json formatting and show the data similar to how events does it in the 'parameters' column

# settings 

- change 'build' to 'system', merge paths into the same box, in a visually -separated section (like by a horizontal line or similar)
