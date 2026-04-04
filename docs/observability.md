sessions detail page:
- A number of listings for hook when you expand the AI rows or I guess the subagent rows A show no for their values. They they show a time, but no details of what they are other than that they're a hook. We should fix that. 
- I don't see the actual text of the. AI available at all. It should be collapsed by default, but it should be available in in in rows for the AI.
- For tool calls that result in errors. Instead of a separate line for the error, when it comes back, highlight the tool call in red, and then when expanding the row for that tool call, show the error there. 
- Add minimal indication of whether A particular AI message is from the root cloud instance or a sub agent. 
- In session detail, Take the visible context Information at the bottom of the page. Move it to the right sidebar. It's a wide screen monitor, so there's plenty of space.  
- Add a buttons to The session detail at the top and bottom right of the list of messages. To scroll to the bottom or top as a shortcut if you're already at the top or bottom that Button should be hidden.
- Make sure that there's support for displaying a bold or any other formatting injected by cloud. I don't think that's full markdown support probably, but. There shouldn't be asterisks around anything It should be bold, for example
- In the events age for agent terms where it currently shows just a duration of time for the detail, Have it show the the initial parts of the text the agents produced. Make the full text available when clicking into the row. 
- 
settings:

- most of the paths can be removed as there's no separate dev environment anymore.  keep the construct db, memory db, telemetry and backup paths
- In paths show which ones are actually real directories and which ones are symlinks, if symlinked show the target after the path, like path -> target
- Remove environments from runtime. Combine the build and runtime sections. 
- Bold the tokens, age into the observability overview. Change the breakdown by model to a doughnut chart. Overlay cost and tokens together on the same chart. Move the stats at the top of the tokens page to the Observability data cards. 
- If you look at many pages in observability, there's a control at the top right, usually with granularity, hour or day. And. The date range for sessions. Can we move that to the same line as the header? Not every control on that applies to every page. Is it possible to hide The elements of it that are not applicable if something doesn't support granularity but does have a Date range. We shouldn't see granularity. 

observability, in general:
- fold the subagents page into sessions; move the total dispatches and spawner sessions into the sessions list data cards; make the table showing subagents by type a donut chart on the session list page.  Highlight in session detail whewn a subagent was dispatched, with what, how long it took and what the results was including errors.

- rename the hooks page to scripts
- instead of overview being a distinct page, change it so that clicking on observability takes you there without highlighting anything beneath.
- Update the skills page.Add a filter that Will exclude any skill or command That isn't currently installed. Even if it's used a lot historically, but it's not there now It shouldn't be dislayed in the table. 
- In the skill detail page Take the descripcion in the front matter for the killer command and Display it below the header. You can elide it if it's unusually long. 
- In the hooks page. Remove mode, gate Columns. Remove the gate markers Card. And remove the hook executions over time chart. Replace it with a donut chart that shows Executions by hook Over the specified Date range.
- In these sessions list page Update the table as follows. Combine the user and assistance columns into a single column. Remove lines and commits. Remove mode. Remove tool calls. Make the Project column wider so that you can see more of the initial text of the conversation. Move the display of the repo or folder that the session was taking place in into its own column. 
- Add a line and bar chart toggle to Dailyactivity and Utah Dailyactivity on the same row as daily sessions. 
- On the tools page, add usage overtime statistics similar to other pages. Move the percentage horizontal line. At the far right of the column to a donut chart at the top of the page that shows the distribution of tool calls respecting the the time range control at top. 
- On the events page there is a number of events that have null for detail. Replace that with a dash. 
- In the sessions list, add some representation of How many actions were taken by the root assistant or subagents it dispatched and have that bea data card overall as well as displayed somehow per row in the table underneath? 

memory:
- combine memory and database pages.  convert memory by type to a donut charge, same for tags (can combine low-frequency tags if needed)
- In the combined memory and database page, make it so that rows showing individual memories can be expanded to show the full contents of those memories. 
- In the memory and database page, adjust how the text is displayed unexpanded in the table. See if you can just show the text of what was going on there without a whole lot of the extra data if possible. 
- Add a counter of how many times that memory has been searched for and recalled. 
- Put memory count overtime in the same line as the other Charts. 
- In the table, add a button that will allow editing of that memory as well as deleting it. 
- See if you can find a more compact way of displaying the tables and rows for the database. 
- Also, when clicking into one of the database tables, can we display what the actual contents are? Make sure that's paginated so it doesn't increase the length of the page too much. 

- 
questions: 
- How can we standardize many of the charts and observability so that on ages like hooks and skills and sessions we have the same kind of information shown? I think we want activity overtime and if relevant, some sort of donut chart that shows the breakdown by type of whatever we're looking at. In cases where there's two charts, can we put them all on the same line? 
- How hard would it be to make this context window display work on a? Return basis so. If I clicked on a particular turn, the right sidebar would show the context at that point. 


